import { neon } from "@neondatabase/serverless";
import type { AvatarProviderId } from "./avatar-provider.js";
import { deriveSetupStates, scopesForKind, type IdentityAssetSummary, type SetupState } from "./avatar-requirements.js";
import { IDENTITY_CONSENT_VERSION, identityConsentText, sha256Hex } from "./consent-text.js";
import { IDENTITY_RETENTION_DAYS, identityPathname, pathnameBelongsTo, type IdentityKind } from "./identity-storage.js";

/** Server-side persistence for consent, private materials and avatar setup (owner DB role). */
type Sql = ReturnType<typeof neon>;
export type Scope = "FACE" | "VOICE";

export type ConsentRow = { id: string; subject_name: string; scopes: Scope[]; consent_version: string; granted_at: string; revoked_at: string | null };
export type AssetRow = IdentityAssetSummary & { pathname: string; content_type: string; size_bytes: number | null; rejection_reason: string | null; retention_until: string; created_at: string; media: Record<string, unknown> };
export type SetupRow = { provider: AvatarProviderId; face_status: SetupState; voice_status: SetupState; provider_avatar_id: string | null; provider_voice_id: string | null; last_error_code: string | null; last_preview_job_id: string | null; cost_usd: number };

const PROVIDER_STATES: SetupState[] = ["SUBMITTED", "TRAINING", "READY", "FAILED"];

export async function activeConsent(sql: Sql, profileId: string) {
  const rows = await sql`
    select id::text, subject_name, scopes, consent_version, granted_at, revoked_at from public.identity_consents
    where profile_id=${profileId}::uuid and revoked_at is null limit 1` as unknown as ConsentRow[];
  return rows[0] ?? null;
}

export async function listAssets(sql: Sql, profileId: string) {
  const rows = await sql`
    select id::text, kind, status, pathname, content_type, size_bytes, duration_seconds::float8 as duration_seconds, media,
           rejection_reason, retention_until, created_at
    from public.identity_assets where profile_id=${profileId}::uuid and status <> 'DELETED' order by created_at desc limit 50` as unknown as AssetRow[];
  return rows.map((row) => ({ ...row, size_bytes: row.size_bytes === null ? null : Number(row.size_bytes), width: Number(row.media?.width) || null, height: Number(row.media?.height) || null, has_audio: typeof row.media?.hasAudio === "boolean" ? row.media.hasAudio as boolean : null }));
}

export async function getSetup(sql: Sql, profileId: string): Promise<SetupRow> {
  const rows = await sql`
    select provider, face_status, voice_status, provider_avatar_id, provider_voice_id, last_error_code, last_preview_job_id::text, cost_usd::float8 as cost_usd
    from public.avatar_setups where profile_id=${profileId}::uuid` as unknown as SetupRow[];
  return rows[0] ?? { provider: "HEYGEN", face_status: "NOT_STARTED", voice_status: "NOT_STARTED", provider_avatar_id: null, provider_voice_id: null, last_error_code: null, last_preview_job_id: null, cost_usd: 0 };
}

/** Recomputes face/voice states from consent + materials, unless a provider step owns them. */
export async function refreshSetup(sql: Sql, profileId: string, provider?: AvatarProviderId) {
  const current = await getSetup(sql, profileId);
  const chosen = provider ?? current.provider;
  const consent = await activeConsent(sql, profileId);
  const assets = await listAssets(sql, profileId);
  const derived = deriveSetupStates({ provider: chosen, consentScopes: consent?.scopes ?? null, assets });
  const keep = (state: SetupState) => chosen === current.provider && PROVIDER_STATES.includes(state);
  const face = !consent && current.face_status !== "NOT_STARTED" ? "REVOKED" : keep(current.face_status) ? current.face_status : derived.face;
  const voice = !consent && current.voice_status !== "NOT_STARTED" ? "REVOKED" : keep(current.voice_status) ? current.voice_status : derived.voice;
  await sql`
    insert into public.avatar_setups (profile_id, provider, face_status, voice_status, updated_at)
    values (${profileId}::uuid, ${chosen}, ${face}, ${voice}, now())
    on conflict (profile_id) do update set provider=excluded.provider, face_status=excluded.face_status, voice_status=excluded.voice_status, updated_at=now()`;
  return { ...(await getSetup(sql, profileId)), missing: derived.missing };
}

export async function grantConsent(sql: Sql, input: { profileId: string; subjectName: string; scopes: Scope[]; grantedBy: string; evidence: Record<string, unknown> }) {
  const scopes = [...new Set(input.scopes)].filter((scope): scope is Scope => scope === "FACE" || scope === "VOICE");
  if (!scopes.length) throw new Error("IDENTITY_CONSENT_SCOPES_INVALID");
  const name = input.subjectName.replace(/\s+/g, " ").trim();
  if (name.length < 2 || name.length > 120) throw new Error("IDENTITY_CONSENT_SUBJECT_INVALID");
  if (await activeConsent(sql, input.profileId)) throw new Error("IDENTITY_CONSENT_ALREADY_ACTIVE");
  const hash = await sha256Hex(identityConsentText(name, scopes));
  const rows = await sql`
    insert into public.identity_consents (profile_id, subject_name, scopes, consent_version, consent_text_sha256, granted_by, evidence)
    values (${input.profileId}::uuid, ${name}, ${scopes}::text[], ${IDENTITY_CONSENT_VERSION}, ${hash}, ${input.grantedBy}, ${JSON.stringify(input.evidence)}::jsonb)
    returning id::text` as unknown as Array<{ id: string }>;
  await refreshSetup(sql, input.profileId);
  return { id: rows[0].id, version: IDENTITY_CONSENT_VERSION, sha256: hash };
}

/** Revocation blocks new generations at once; materials are deleted when asked (or at retention end). */
export async function revokeConsent(sql: Sql, profileId: string, revokedBy: string) {
  const rows = await sql`
    update public.identity_consents set revoked_at=now(), revoked_by=${revokedBy}
    where profile_id=${profileId}::uuid and revoked_at is null returning id::text` as unknown as Array<{ id: string }>;
  await sql`
    update public.render_jobs set state='CANCELED', last_error_code='IDENTITY_CONSENT_REVOKED', claim_token=null, lease_expires_at=null, completed_at=now(), updated_at=now()
    where profile_id=${profileId}::uuid and kind='REEL_AVATAR' and state in ('QUEUED','RUNNING')`;
  await sql`
    insert into public.avatar_setups (profile_id, face_status, voice_status, updated_at) values (${profileId}::uuid, 'REVOKED', 'REVOKED', now())
    on conflict (profile_id) do update set face_status='REVOKED', voice_status='REVOKED', updated_at=now()`;
  return { revoked: rows.length };
}

export async function prepareAsset(sql: Sql, input: { profileId: string; kind: IdentityKind; contentType: string; createdBy: string }) {
  const consent = await activeConsent(sql, input.profileId);
  if (!consent) throw new Error("IDENTITY_CONSENT_REQUIRED");
  if (!scopesForKind(input.kind).every((scope) => consent.scopes.includes(scope))) throw new Error("IDENTITY_CONSENT_SCOPE_MISSING");
  const pending = await sql`
    select count(*)::int as count from public.identity_assets
    where profile_id=${input.profileId}::uuid and status='PENDING_UPLOAD' and created_at > now() - interval '1 hour'` as unknown as Array<{ count: number }>;
  if ((pending[0]?.count ?? 0) >= 10) throw new Error("IDENTITY_TOO_MANY_PENDING_UPLOADS");
  const id = crypto.randomUUID();
  const pathname = identityPathname(input.profileId, input.kind, input.contentType, id);
  await sql`
    insert into public.identity_assets (id, profile_id, consent_id, kind, pathname, content_type, retention_until, created_by)
    values (${id}::uuid, ${input.profileId}::uuid, ${consent.id}::uuid, ${input.kind}, ${pathname}, ${input.contentType},
            now() + make_interval(days => ${IDENTITY_RETENTION_DAYS}), ${input.createdBy})`;
  return { assetId: id, pathname };
}

export async function assetById(sql: Sql, profileId: string, assetId: string) {
  const rows = await sql`
    select id::text, kind, status, pathname, content_type from public.identity_assets
    where id=${assetId}::uuid and profile_id=${profileId}::uuid and status <> 'DELETED' limit 1` as unknown as Array<{ id: string; kind: IdentityKind; status: string; pathname: string; content_type: string }>;
  const row = rows[0] ?? null;
  if (row && !pathnameBelongsTo(row.pathname, profileId, row.kind)) throw new Error("IDENTITY_PATHNAME_SCOPE_INVALID");
  return row;
}

export async function completeAsset(sql: Sql, input: { profileId: string; assetId: string; status: "READY" | "REJECTED"; sizeBytes: number | null; durationSeconds: number | null; media: Record<string, unknown>; rejection: string | null }) {
  await sql`
    update public.identity_assets set status=${input.status}, size_bytes=${input.sizeBytes}, duration_seconds=${input.durationSeconds},
      media=${JSON.stringify(input.media)}::jsonb, rejection_reason=${input.rejection}, updated_at=now()
    where id=${input.assetId}::uuid and profile_id=${input.profileId}::uuid and status='PENDING_UPLOAD'`;
  return refreshSetup(sql, input.profileId);
}

export async function markAssetsDeleted(sql: Sql, profileId: string, assetIds: string[] | "ALL") {
  const rows = (assetIds === "ALL"
    ? await sql`update public.identity_assets set status='DELETED', deleted_at=now(), updated_at=now() where profile_id=${profileId}::uuid and status <> 'DELETED' returning pathname`
    : await sql`update public.identity_assets set status='DELETED', deleted_at=now(), updated_at=now() where profile_id=${profileId}::uuid and id = any(${assetIds}::uuid[]) and status <> 'DELETED' returning pathname`) as unknown as Array<{ pathname: string }>;
  await refreshSetup(sql, profileId);
  return rows.map((row) => row.pathname).filter((pathname) => pathnameBelongsTo(pathname, profileId));
}

/** Retention: materials past retention_until (or stale pending uploads) are removed. */
export async function expiredIdentityPathnames(sql: Sql, limit = 50) {
  const rows = await sql`
    update public.identity_assets set status='DELETED', deleted_at=now(), updated_at=now()
    where id in (select id from public.identity_assets where status <> 'DELETED'
                 and (retention_until < now() or (status='PENDING_UPLOAD' and created_at < now() - interval '1 day')) limit ${limit})
    returning profile_id::text, pathname` as unknown as Array<{ profile_id: string; pathname: string }>;
  return rows.filter((row) => pathnameBelongsTo(row.pathname, row.profile_id)).map((row) => row.pathname);
}
