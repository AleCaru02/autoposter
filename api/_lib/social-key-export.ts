import { neon } from "@neondatabase/serverless";
import { decryptTokenBundle, encryptTokenBundle } from "./social.js";

/**
 * One-shot QA → production transfer of verified social connections WITHOUT plaintext leaving
 * this function: each token bundle is decrypted with the QA key and immediately re-encrypted
 * with SOCIAL_TOKEN_KEY_NEXT (the production key, set on both environments by the owner-approved
 * procedure). Only ciphertext is persisted, in a server-only table that browsers cannot read.
 *
 * Fail-closed: disabled unless SOCIAL_KEY_EXPORT_ENABLED === "true" and both keys are present.
 * Never logs token material; returns only counts, providers and fingerprints of ciphertext.
 */
export type KeyExportEnv = {
  DATABASE_URL?: string;
  SOCIAL_TOKEN_KEY?: string;
  SOCIAL_TOKEN_KEY_NEXT?: string;
  SOCIAL_KEY_EXPORT_ENABLED?: string;
};

export function keyExportEnabled(env: KeyExportEnv) {
  return env.SOCIAL_KEY_EXPORT_ENABLED?.trim().toLowerCase() === "true"
    && Boolean(env.DATABASE_URL)
    && (env.SOCIAL_TOKEN_KEY?.length ?? 0) >= 24
    && (env.SOCIAL_TOKEN_KEY_NEXT?.length ?? 0) >= 24
    && env.SOCIAL_TOKEN_KEY !== env.SOCIAL_TOKEN_KEY_NEXT;
}

/** Re-encrypts one stored reference from the current key to the next key (plaintext stays in memory). */
export async function reencryptReference(reference: string, currentKey: string, nextKey: string) {
  const bundle = await decryptTokenBundle(reference, currentKey);
  const next = await encryptTokenBundle(bundle, nextKey);
  // Prove the new ciphertext opens with the next key before anything is stored.
  const check = await decryptTokenBundle(next, nextKey);
  if (check.accessToken !== bundle.accessToken || (check.refreshToken ?? null) !== (bundle.refreshToken ?? null)) throw new Error("KEY_EXPORT_ROUNDTRIP_FAILED");
  return next;
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function exportProfileConnections(env: KeyExportEnv, profileId: string) {
  if (!keyExportEnabled(env)) return { status: 503, body: { error: "KEY_EXPORT_DISABLED" } };
  const sql = neon(env.DATABASE_URL!);
  await sql`create table if not exists public.social_token_exports (
    profile_id uuid not null, provider text not null, provider_account_id text, account_name text,
    permissions jsonb not null default '[]'::jsonb, expires_at timestamptz, metadata jsonb not null default '{}'::jsonb,
    token_reference_next text not null, created_at timestamptz not null default now(),
    primary key (profile_id, provider))`;
  await sql`revoke all on public.social_token_exports from public`;
  await sql`do $$ begin if exists (select 1 from pg_roles where rolname='authenticated') then revoke all on public.social_token_exports from authenticated; end if; if exists (select 1 from pg_roles where rolname='anonymous') then revoke all on public.social_token_exports from anonymous; end if; end $$`;
  const rows = await sql`
    select provider, provider_account_id, account_name, permissions, expires_at, metadata, token_reference
    from public.social_connections
    where profile_id=${profileId}::uuid and status='ACTIVE' and token_reference is not null
      and (metadata->'lastVerification'->>'ok')='true'
  ` as unknown as Array<{ provider: string; provider_account_id: string | null; account_name: string | null; permissions: unknown; expires_at: string | null; metadata: Record<string, unknown> | null; token_reference: string }>;
  const exported: Array<{ provider: string; fingerprint: string }> = [];
  const failed: Array<{ provider: string; code: string }> = [];
  for (const row of rows) {
    try {
      const next = await reencryptReference(row.token_reference, env.SOCIAL_TOKEN_KEY!, env.SOCIAL_TOKEN_KEY_NEXT!);
      const metadata = { ...(row.metadata ?? {}) };
      delete metadata.candidates;
      delete metadata.lastOAuthError;
      await sql`
        insert into public.social_token_exports (profile_id, provider, provider_account_id, account_name, permissions, expires_at, metadata, token_reference_next)
        values (${profileId}::uuid, ${row.provider}, ${row.provider_account_id}, ${row.account_name}, ${JSON.stringify(row.permissions ?? [])}::jsonb, ${row.expires_at}::timestamptz, ${JSON.stringify(metadata)}::jsonb, ${next})
        on conflict (profile_id, provider) do update set provider_account_id=excluded.provider_account_id, account_name=excluded.account_name,
          permissions=excluded.permissions, expires_at=excluded.expires_at, metadata=excluded.metadata, token_reference_next=excluded.token_reference_next, created_at=now()`;
      exported.push({ provider: row.provider, fingerprint: (await sha256Hex(next)).slice(0, 12) });
    } catch (reason) {
      failed.push({ provider: row.provider, code: reason instanceof Error ? reason.message.split(":")[0]!.slice(0, 60) : "EXPORT_FAILED" });
    }
  }
  return { status: failed.length ? 207 : 200, body: { exported, failed } };
}
