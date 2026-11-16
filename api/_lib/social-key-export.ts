import { neon } from "@neondatabase/serverless";
import { decryptTokenBundle, encryptTokenBundle } from "./social.js";
import { verifiedCustomerAuthUserId } from "./verified-customer-auth.js";

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
  /** The single profile allowed to export (owner-approved migration). */
  SOCIAL_KEY_EXPORT_PROFILE_ID?: string;
};

export function keyExportEnabled(env: KeyExportEnv) {
  return env.SOCIAL_KEY_EXPORT_ENABLED?.trim().toLowerCase() === "true"
    && Boolean(env.DATABASE_URL)
    && (env.SOCIAL_TOKEN_KEY?.length ?? 0) >= 24
    && (env.SOCIAL_TOKEN_KEY_NEXT?.length ?? 0) >= 24
    && env.SOCIAL_TOKEN_KEY !== env.SOCIAL_TOKEN_KEY_NEXT
    && /^[0-9a-f-]{36}$/i.test(env.SOCIAL_KEY_EXPORT_PROFILE_ID?.trim() ?? "");
}

type OwnerDeps = {
  callerId: (token: string) => Promise<string | null>;
  ownerId: (profileId: string) => Promise<string | null>;
};

/**
 * Only the profile OWNER may export, and only for the configured profile. A member, an
 * editor or any other authenticated user with read access to the profile is refused.
 */
export async function authorizeExport(env: KeyExportEnv, token: string, profileId: string, deps?: OwnerDeps) {
  if (!keyExportEnabled(env)) return "KEY_EXPORT_DISABLED";
  if (profileId !== env.SOCIAL_KEY_EXPORT_PROFILE_ID!.trim()) return "KEY_EXPORT_PROFILE_NOT_ALLOWED";
  const resolved: OwnerDeps = deps ?? {
    callerId: (value) => verifiedCustomerAuthUserId(value, env.DATABASE_URL!),
    ownerId: async (id) => {
      const rows = await neon(env.DATABASE_URL!)`select owner_auth_user_id::text as owner from public.profiles where id=${id}::uuid and archived_at is null limit 1` as unknown as Array<{ owner: string | null }>;
      return rows[0]?.owner ?? null;
    },
  };
  const [caller, owner] = await Promise.all([resolved.callerId(token), resolved.ownerId(profileId)]);
  if (!caller) return "SESSION_INVALID";
  if (!owner || caller !== owner) return "KEY_EXPORT_OWNER_REQUIRED";
  return null;
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
  // The server-only table is provisioned by the database owner (the app role cannot run DDL):
  // revoked from public/authenticated/anonymous, granted select/insert/update to the app role.
  const table = await sql`select to_regclass('public.social_token_exports') as name, has_table_privilege('authenticated', 'public.social_token_exports', 'SELECT') as browser_read` as unknown as Array<{ name: string | null; browser_read: boolean | null }>;
  if (!table[0]?.name) return { status: 503, body: { error: "KEY_EXPORT_TABLE_MISSING" } };
  if (table[0].browser_read) return { status: 503, body: { error: "KEY_EXPORT_TABLE_NOT_PRIVATE" } };
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
