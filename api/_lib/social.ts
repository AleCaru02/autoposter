import { neon } from "@neondatabase/serverless";
import { EntitlementUsageService } from "./entitlement-usage.js";
import type { CapabilityKey } from "./capabilities.js";

const DATA_API = "https://ep-nameless-truth-a698bwer.apirest.us-west-2.aws.neon.tech/neondb/rest/v1";
const PROVIDERS = ["INSTAGRAM", "FACEBOOK", "LINKEDIN", "GBP"] as const;
const META_SCOPES = {
  FACEBOOK: ["pages_show_list", "pages_read_engagement", "pages_manage_posts"],
  INSTAGRAM: ["pages_show_list", "pages_read_engagement", "instagram_basic", "instagram_content_publish"],
} as const;
const GOOGLE_SCOPE = "https://www.googleapis.com/auth/business.manage";

export type SocialProvider = typeof PROVIDERS[number];
export type SocialEnv = {
  DATABASE_URL?: string;
  APP_BASE_URL?: string;
  SOCIAL_TOKEN_KEY?: string;
  META_APP_ID?: string;
  META_APP_SECRET?: string;
  META_GRAPH_VERSION?: string;
  LINKEDIN_CLIENT_ID?: string;
  LINKEDIN_CLIENT_SECRET?: string;
  LINKEDIN_API_VERSION?: string;
  LINKEDIN_ORGANIZATION_ACCESS?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
};

type OAuthState = {
  provider: SocialProvider;
  profileId: string;
  callbackUri: string;
  exp: number;
  nonce: string;
};

type TokenBundle = {
  accessToken: string;
  refreshToken?: string | null | undefined;
  expiresAt?: string | null | undefined;
  kind?: string | undefined;
};

type Candidate = {
  id: string;
  name: string;
  accountId?: string | undefined;
  pageId?: string | undefined;
  username?: string | undefined;
  kind?: string | undefined;
};

type ConnectionRow = {
  provider: SocialProvider;
  status: string;
  provider_account_id: string | null;
  account_name: string | null;
  permissions: unknown;
  expires_at: string | null;
  metadata: unknown;
  last_validated_at: string | null;
  updated_at: string;
};

type StoredConnection = ConnectionRow & { token_reference: string | null };
type VariantRecord = {
  id: string;
  content_id: string;
  profile_id: string;
  provider: SocialProvider;
  format: string;
  caption: string;
  hook: string | null;
  cta: string | null;
  hashtags: unknown;
  alt_text: string | null;
  image_asset_id: string | null;
  approval_status: string;
  eligible: boolean;
  storage_url: string | null;
  mime_type: string | null;
};
type JobRecord = {
  id: string;
  profile_id: string;
  variant_id: string;
  provider: SocialProvider;
  scheduled_at: string;
  attempt_count: number;
  claim_token: string;
  lease_expires_at: string;
};

type PublishResult = { externalId: string; metadata?: Record<string, unknown> | undefined };
type PublishBoundary = () => Promise<void>;

export class SocialPublishError extends Error {
  constructor(
    public readonly code: string,
    public readonly retryable: boolean,
    public readonly outcomeUnknown: boolean,
    public readonly customerMessage: string,
  ) { super(code); this.name = "SocialPublishError"; }
}

function publishError(code: string, options: { retryable?: boolean; outcomeUnknown?: boolean; customerMessage?: string } = {}) {
  return new SocialPublishError(
    code,
    options.retryable === true,
    options.outcomeUnknown === true,
    options.customerMessage || "La pubblicazione non è riuscita.",
  );
}

export function classifyProviderFailure(provider: SocialProvider, stage: string, status: number | null, visibleWriteStarted: boolean) {
  const prefix = provider === "INSTAGRAM" ? "INSTAGRAM" : provider === "FACEBOOK" ? "FACEBOOK" : provider === "LINKEDIN" ? "LINKEDIN" : "GBP";
  if (status === 429) return publishError(`${prefix}_RATE_LIMITED`, { retryable: true, customerMessage: "Il social ha chiesto di riprovare più tardi." });
  if (status === 401 || status === 403) return publishError(`${prefix}_RECONNECT_REQUIRED`, { customerMessage: "Ricollega il social prima di riprovare." });
  if (status === 400 || status === 404 || status === 409 || status === 422) return publishError(`${prefix}_CONTENT_REJECTED`, { customerMessage: "Il social ha rifiutato contenuto o formato." });
  if (visibleWriteStarted) return publishError("PROVIDER_OUTCOME_UNKNOWN", { outcomeUnknown: true, customerMessage: "La pubblicazione potrebbe essere avvenuta: verifica il social prima di riprovare." });
  return publishError(`${prefix}_${stage}_TEMPORARY`, { retryable: true, customerMessage: "Il social non è disponibile. Il sistema riproverà automaticamente." });
}

export function retryDelaySeconds(jobId: string, attemptNo: number) {
  const base = Math.min(300 * (2 ** Math.max(attemptNo - 1, 0)), 3600);
  let hash = 0;
  for (const char of jobId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return base + (hash % 91);
}

async function providerRequest(input: string | URL, init: RequestInit, options: {
  provider: SocialProvider; stage: string; visibleWrite?: boolean; beforeVisibleWrite?: PublishBoundary; timeoutMs?: number;
}) {
  const visibleWrite = options.visibleWrite === true;
  if (visibleWrite && options.beforeVisibleWrite) await options.beforeVisibleWrite();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 25_000);
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    if (!response.ok) throw classifyProviderFailure(options.provider, options.stage, response.status, visibleWrite);
    return response;
  } catch (reason) {
    if (reason instanceof SocialPublishError) throw reason;
    throw classifyProviderFailure(options.provider, options.stage, null, visibleWrite);
  } finally { clearTimeout(timeout); }
}

async function providerJson<T>(response: Response, provider: SocialProvider, stage: string, visibleWriteStarted: boolean): Promise<T> {
  try {
    return await response.json() as T;
  } catch {
    throw classifyProviderFailure(provider, `${stage}_RESPONSE`, null, visibleWriteStarted);
  }
}

function terminalPublishError(code: string) {
  if (code === "CONTENT_NOT_APPROVED") return publishError(code, { customerMessage: "Il contenuto deve essere approvato prima della pubblicazione." });
  if (code === "SOCIAL_NOT_CONNECTED" || code.includes("RECONNECT_REQUIRED") || code === "TOKEN_REFERENCE_INVALID") return publishError("SOCIAL_RECONNECT_REQUIRED", { customerMessage: "Ricollega il social prima di riprovare." });
  if (code.includes("FORMAT") || code.includes("MEDIA") || code.includes("ASSET")) return publishError("CONTENT_MEDIA_INVALID", { customerMessage: "Controlla formato e immagine del contenuto." });
  if (code.includes("CAPABILITY") || code.includes("ENTITLEMENT")) return publishError("PUBLISHING_NOT_AVAILABLE", { customerMessage: "La pubblicazione automatica non è disponibile per questa attività." });
  return publishError("SOCIAL_PUBLISH_FAILED");
}

type GoogleRequestRuntime = {
  fetch?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
  maxAttempts?: number;
};

type GoogleApiResult<T> = { body: T; attempts: number };

type OAuthCallbackClaim = {
  claimed: boolean;
  status: "PROCESSING" | "COMPLETED" | "FAILED";
  result: Record<string, string>;
};

type Sql = ReturnType<typeof neon>;

const GOOGLE_MAX_ATTEMPTS = 3;
const GOOGLE_RETRY_BASE_MS = 250;
const GOOGLE_MAX_RETRY_DELAY_MS = 2_000;

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function googlePublicError(status: number) {
  if (status === 429) return "GBP_RATE_LIMITED";
  if (status === 401 || status === 403) return "GBP_ACCESS_DENIED";
  return `GBP_PROVIDER_${status}`;
}

export async function googleApiJson<T>(url: string | URL, headers: HeadersInit, runtime: GoogleRequestRuntime = {}): Promise<GoogleApiResult<T>> {
  const request = runtime.fetch ?? fetch;
  const pause = runtime.sleep ?? sleep;
  const random = runtime.random ?? Math.random;
  const maxAttempts = Math.max(1, Math.min(runtime.maxAttempts ?? GOOGLE_MAX_ATTEMPTS, GOOGLE_MAX_ATTEMPTS));
  let lastStatus = 502;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await request(url, { headers });
    lastStatus = response.status;
    const body = await response.json().catch(() => ({})) as T;
    if (response.ok) return { body, attempts: attempt };

    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === maxAttempts) throw new Error(googlePublicError(response.status));
    const retryAfterSeconds = Number(response.headers.get("retry-after"));
    const retryAfterMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0 ? retryAfterSeconds * 1_000 : 0;
    const exponentialMs = GOOGLE_RETRY_BASE_MS * (2 ** (attempt - 1));
    const jitterMs = Math.floor(random() * GOOGLE_RETRY_BASE_MS);
    await pause(Math.min(Math.max(retryAfterMs, exponentialMs + jitterMs), GOOGLE_MAX_RETRY_DELAY_MS));
  }

  throw new Error(googlePublicError(lastStatus));
}

function socialJson(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function bearer(request: Request) {
  const value = request.headers.get("authorization");
  return value?.startsWith("Bearer ") ? value.slice(7).trim() || null : null;
}

async function readBody(request: Request) {
  try { return await request.json() as Record<string, unknown>; }
  catch { return {}; }
}

function isProvider(value: unknown): value is SocialProvider {
  return typeof value === "string" && (PROVIDERS as readonly string[]).includes(value);
}

function baseUrl(env: SocialEnv, requestUrl?: string) {
  const configured = env.APP_BASE_URL?.trim().replace(/\/$/, "");
  if (configured) return configured;
  return requestUrl ? new URL(requestUrl).origin : "";
}

function metaVersion(env: SocialEnv) {
  const value = env.META_GRAPH_VERSION?.trim() || "v26.0";
  return /^v\d+\.\d+$/.test(value) ? value : "v26.0";
}

function linkedinVersion(env: SocialEnv) {
  const value = env.LINKEDIN_API_VERSION?.trim() || "202608";
  return /^20\d{4}$/.test(value) ? value : "202608";
}

function linkedinOrganizationMode(env: SocialEnv) {
  return env.LINKEDIN_ORGANIZATION_ACCESS?.trim().toLowerCase() === "true";
}

export function missingProviderConfiguration(provider: SocialProvider, env: SocialEnv) {
  const missing: string[] = [];
  if (!env.DATABASE_URL) missing.push("DATABASE_URL");
  if (!env.SOCIAL_TOKEN_KEY) missing.push("SOCIAL_TOKEN_KEY");
  else if (env.SOCIAL_TOKEN_KEY.length < 24) missing.push("SOCIAL_TOKEN_KEY (minimo 24 caratteri)");
  if (provider === "FACEBOOK" || provider === "INSTAGRAM") {
    if (!env.META_APP_ID) missing.push("META_APP_ID");
    if (!env.META_APP_SECRET) missing.push("META_APP_SECRET");
  } else if (provider === "LINKEDIN") {
    if (!env.LINKEDIN_CLIENT_ID) missing.push("LINKEDIN_CLIENT_ID");
    if (!env.LINKEDIN_CLIENT_SECRET) missing.push("LINKEDIN_CLIENT_SECRET");
  } else {
    if (!env.GOOGLE_CLIENT_ID) missing.push("GOOGLE_CLIENT_ID");
    if (!env.GOOGLE_CLIENT_SECRET) missing.push("GOOGLE_CLIENT_SECRET");
  }
  return missing;
}

export function providerConfigured(provider: SocialProvider, env: SocialEnv) {
  return missingProviderConfiguration(provider, env).length === 0;
}

export function providerCapabilities(provider: SocialProvider) {
  if (provider === "INSTAGRAM") return { publish: ["POST", "STORY"], note: "Carosello disponibile quando il contenuto contiene più media reali." };
  if (provider === "FACEBOOK") return { publish: ["POST"], note: "Storie e caroselli non vengono simulati finché il contenuto non ha gli asset richiesti dalle API." };
  if (provider === "LINKEDIN") return { publish: ["POST"], note: "I caroselli organici richiedono più immagini; le storie non sono un formato LinkedIn." };
  return { publish: ["POST"], note: "Google Business Profile pubblica Local Posts; storie e caroselli non esistono nell’API GBP." };
}

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function hmac(value: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(`state:${secret}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return toBase64Url(new Uint8Array(signature));
}

export async function createOAuthState(input: Omit<OAuthState, "exp" | "nonce">, secret: string, now = Date.now()) {
  const payload: OAuthState = { ...input, exp: now + 10 * 60_000, nonce: crypto.randomUUID() };
  const encoded = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  return `${encoded}.${await hmac(encoded, secret)}`;
}

export async function verifyOAuthState(value: string, secret: string, now = Date.now()): Promise<OAuthState> {
  const [encoded, signature] = value.split(".");
  if (!encoded || !signature) throw new Error("OAUTH_STATE_INVALID");
  const expected = await hmac(encoded, secret);
  if (expected.length !== signature.length) throw new Error("OAUTH_STATE_INVALID");
  let diff = 0;
  for (let index = 0; index < expected.length; index += 1) diff |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
  if (diff !== 0) throw new Error("OAUTH_STATE_INVALID");
  const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(encoded))) as OAuthState;
  if (!isProvider(payload.provider) || !payload.profileId || !payload.callbackUri || payload.exp < now) throw new Error("OAUTH_STATE_EXPIRED");
  return payload;
}

async function aesKey(secret: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`token:${secret}`));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptTokenBundle(bundle: TokenBundle, secret: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(secret), new TextEncoder().encode(JSON.stringify(bundle)));
  return `enc:v1:${toBase64Url(iv)}:${toBase64Url(new Uint8Array(cipher))}`;
}

export async function decryptTokenBundle(value: string, secret: string): Promise<TokenBundle> {
  const [prefix, version, ivPart, cipherPart] = value.split(":");
  if (prefix !== "enc" || version !== "v1" || !ivPart || !cipherPart) throw new Error("TOKEN_REFERENCE_INVALID");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64Url(ivPart) }, await aesKey(secret), fromBase64Url(cipherPart));
  const bundle = JSON.parse(new TextDecoder().decode(plain)) as TokenBundle;
  if (!bundle.accessToken) throw new Error("TOKEN_REFERENCE_INVALID");
  return bundle;
}

async function dataApi(path: string, token: string, init: RequestInit = {}) {
  return fetch(`${DATA_API}/${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
}

type ProfileAccess = { allowed: boolean; upstreamStatus: number | null };

async function profileAccess(profileId: string, token: string): Promise<ProfileAccess> {
  const response = await dataApi(`profiles?id=eq.${encodeURIComponent(profileId)}&select=id&limit=1`, token);
  if (!response.ok) return { allowed: false, upstreamStatus: response.status };
  const rows = await response.json() as Array<{ id?: string }>;
  return { allowed: rows.some((row) => row.id === profileId), upstreamStatus: null };
}

async function canAccessProfile(profileId: string, token: string) {
  return (await profileAccess(profileId, token)).allowed;
}

function connectionMetadata(value: unknown) {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function safeCandidates(value: unknown): Candidate[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    if (typeof row.id !== "string" || typeof row.name !== "string") return [];
    return [{
      id: row.id,
      name: row.name,
      accountId: typeof row.accountId === "string" ? row.accountId : undefined,
      pageId: typeof row.pageId === "string" ? row.pageId : undefined,
      username: typeof row.username === "string" ? row.username : undefined,
      kind: typeof row.kind === "string" ? row.kind : undefined,
    }];
  }).slice(0, 100);
}

async function upsertConnection(sql: Sql, input: {
  profileId: string;
  provider: SocialProvider;
  status: string;
  providerAccountId?: string | null | undefined;
  accountName?: string | null | undefined;
  tokenReference?: string | null | undefined;
  permissions?: string[] | undefined;
  expiresAt?: string | null | undefined;
  metadata?: Record<string, unknown> | undefined;
}) {
  const metadata = JSON.stringify(input.metadata ?? {});
  const permissions = JSON.stringify(input.permissions ?? []);
  await sql`
    insert into public.social_connections
      (profile_id, provider, status, provider_account_id, account_name, token_reference, permissions, expires_at, metadata, last_validated_at, updated_at)
    values
      (${input.profileId}::uuid, ${input.provider}, ${input.status}, ${input.providerAccountId ?? null}, ${input.accountName ?? null}, ${input.tokenReference ?? null}, ${permissions}::jsonb, ${input.expiresAt ?? null}::timestamptz, ${metadata}::jsonb, now(), now())
    on conflict (profile_id, provider) do update set
      status = excluded.status,
      provider_account_id = excluded.provider_account_id,
      account_name = excluded.account_name,
      token_reference = excluded.token_reference,
      permissions = excluded.permissions,
      expires_at = excluded.expires_at,
      metadata = excluded.metadata,
      last_validated_at = now(),
      updated_at = now()
  `;
}

async function claimOAuthCallback(sql: Sql, state: OAuthState): Promise<OAuthCallbackClaim> {
  const inserted = await sql`
    insert into public.social_oauth_callbacks (nonce, profile_id, provider, status, expires_at)
    values (${state.nonce}, ${state.profileId}::uuid, ${state.provider}, 'PROCESSING', to_timestamp(${Math.floor(state.exp / 1000)}))
    on conflict (nonce) do nothing
    returning status
  ` as unknown as Array<{ status: OAuthCallbackClaim["status"] }>;
  if (inserted[0]) return { claimed: true, status: "PROCESSING", result: {} };

  const existing = await sql`
    select status, result
    from public.social_oauth_callbacks
    where nonce=${state.nonce} and profile_id=${state.profileId}::uuid and provider=${state.provider}
    limit 1
  ` as unknown as Array<{ status: OAuthCallbackClaim["status"]; result: unknown }>;
  const row = existing[0];
  if (!row) return { claimed: false, status: "FAILED", result: {} };
  const result = row.result && typeof row.result === "object" ? row.result as Record<string, string> : {};
  return { claimed: false, status: row.status, result };
}

async function finishOAuthCallback(sql: Sql, state: OAuthState, status: "COMPLETED" | "FAILED", result: Record<string, string>, errorCode?: string) {
  await sql`
    update public.social_oauth_callbacks
    set status=${status}, result=${JSON.stringify(result)}::jsonb, error_code=${errorCode ?? null}, updated_at=now()
    where nonce=${state.nonce} and profile_id=${state.profileId}::uuid and provider=${state.provider}
  `;
}

async function storedConnection(sql: Sql, profileId: string, provider: SocialProvider): Promise<StoredConnection | null> {
  const rows = await sql`
    select provider, status, provider_account_id, account_name, token_reference, permissions, expires_at, metadata, last_validated_at, updated_at
    from public.social_connections
    where profile_id = ${profileId}::uuid and provider = ${provider}
    limit 1
  ` as unknown as StoredConnection[];
  return rows[0] ?? null;
}

function oauthRedirect(state: OAuthState, params: Record<string, string>) {
  const target = new URL("/app/social", new URL(state.callbackUri).origin);
  for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value);
  return Response.redirect(target.toString(), 302);
}

function providerScopes(provider: SocialProvider, env: SocialEnv) {
  if (provider === "FACEBOOK" || provider === "INSTAGRAM") return [...META_SCOPES[provider]];
  if (provider === "GBP") return [GOOGLE_SCOPE];
  return linkedinOrganizationMode(env)
    ? ["openid", "profile", "r_organization_admin", "w_organization_social"]
    : ["openid", "profile", "w_member_social"];
}

function buildAuthorizationUrl(provider: SocialProvider, env: SocialEnv, state: string, callbackUri: string) {
  const scopes = providerScopes(provider, env);
  if (provider === "FACEBOOK" || provider === "INSTAGRAM") {
    const url = new URL(`https://www.facebook.com/${metaVersion(env)}/dialog/oauth`);
    url.searchParams.set("client_id", env.META_APP_ID!);
    url.searchParams.set("redirect_uri", callbackUri);
    url.searchParams.set("state", state);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", scopes.join(","));
    return { url: url.toString(), scopes };
  }
  if (provider === "LINKEDIN") {
    const url = new URL("https://www.linkedin.com/oauth/v2/authorization");
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", env.LINKEDIN_CLIENT_ID!);
    url.searchParams.set("redirect_uri", callbackUri);
    url.searchParams.set("state", state);
    url.searchParams.set("scope", scopes.join(" "));
    return { url: url.toString(), scopes };
  }
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", env.GOOGLE_CLIENT_ID!);
  url.searchParams.set("redirect_uri", callbackUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scopes.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  return { url: url.toString(), scopes };
}

async function metaLongUserToken(code: string, callbackUri: string, env: SocialEnv) {
  const version = metaVersion(env);
  const exchange = new URL(`https://graph.facebook.com/${version}/oauth/access_token`);
  exchange.searchParams.set("client_id", env.META_APP_ID!);
  exchange.searchParams.set("client_secret", env.META_APP_SECRET!);
  exchange.searchParams.set("redirect_uri", callbackUri);
  exchange.searchParams.set("code", code);
  const shortResponse = await fetch(exchange);
  const shortBody = await shortResponse.json() as { access_token?: string; expires_in?: number; error?: { message?: string } };
  if (!shortResponse.ok || !shortBody.access_token) throw new Error(shortBody.error?.message || `META_TOKEN_${shortResponse.status}`);

  const longUrl = new URL(`https://graph.facebook.com/${version}/oauth/access_token`);
  longUrl.searchParams.set("grant_type", "fb_exchange_token");
  longUrl.searchParams.set("client_id", env.META_APP_ID!);
  longUrl.searchParams.set("client_secret", env.META_APP_SECRET!);
  longUrl.searchParams.set("fb_exchange_token", shortBody.access_token);
  const longResponse = await fetch(longUrl);
  const longBody = await longResponse.json() as { access_token?: string; expires_in?: number; error?: { message?: string } };
  if (!longResponse.ok || !longBody.access_token) throw new Error(longBody.error?.message || `META_LONG_TOKEN_${longResponse.status}`);
  return { accessToken: longBody.access_token, expiresIn: longBody.expires_in ?? shortBody.expires_in ?? null };
}

type MetaPage = { id: string; name: string; access_token?: string; instagram_business_account?: { id?: string; username?: string; name?: string } };

async function metaPages(userAccessToken: string, env: SocialEnv) {
  const url = new URL(`https://graph.facebook.com/${metaVersion(env)}/me/accounts`);
  url.searchParams.set("fields", "id,name,access_token,tasks,instagram_business_account{id,username,name}");
  url.searchParams.set("limit", "100");
  url.searchParams.set("access_token", userAccessToken);
  const response = await fetch(url);
  const body = await response.json() as { data?: MetaPage[]; error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message || `META_PAGES_${response.status}`);
  return body.data ?? [];
}

function metaCandidates(provider: "FACEBOOK" | "INSTAGRAM", pages: MetaPage[]): Candidate[] {
  if (provider === "FACEBOOK") return pages.map((page) => ({ id: page.id, name: page.name, pageId: page.id, kind: "PAGE" }));
  return pages.flatMap((page) => {
    const account = page.instagram_business_account;
    if (!account?.id) return [];
    return [{ id: account.id, name: account.name || account.username || page.name, username: account.username, pageId: page.id, kind: "INSTAGRAM_BUSINESS" }];
  });
}

async function activateMetaCandidate(sql: Sql, state: Pick<OAuthState, "profileId" | "provider">, userAccessToken: string, candidateId: string, env: SocialEnv) {
  if (state.provider !== "FACEBOOK" && state.provider !== "INSTAGRAM") throw new Error("META_PROVIDER_INVALID");
  const pages = await metaPages(userAccessToken, env);
  const candidates = metaCandidates(state.provider, pages);
  const candidate = candidates.find((item) => item.id === candidateId);
  if (!candidate) throw new Error("SOCIAL_ACCOUNT_NOT_FOUND");
  const page = pages.find((item) => item.id === candidate.pageId);
  if (!page?.access_token) throw new Error("META_PAGE_TOKEN_MISSING");
  const tokenReference = await encryptTokenBundle({ accessToken: page.access_token, kind: "meta_page" }, env.SOCIAL_TOKEN_KEY!);
  await upsertConnection(sql, {
    profileId: state.profileId,
    provider: state.provider,
    status: "ACTIVE",
    providerAccountId: candidate.id,
    accountName: candidate.username ? `${candidate.name} (@${candidate.username})` : candidate.name,
    tokenReference,
    permissions: providerScopes(state.provider, env),
    metadata: { pageId: candidate.pageId, pageName: page.name, username: candidate.username ?? null, accountKind: candidate.kind },
  });
}

async function linkedinExchange(code: string, callbackUri: string, env: SocialEnv) {
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: env.LINKEDIN_CLIENT_ID!,
    client_secret: env.LINKEDIN_CLIENT_SECRET!,
    redirect_uri: callbackUri,
  });
  const response = await fetch("https://www.linkedin.com/oauth/v2/accessToken", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form });
  const body = await response.json() as { access_token?: string; expires_in?: number; refresh_token?: string; error_description?: string };
  if (!response.ok || !body.access_token) throw new Error(body.error_description || `LINKEDIN_TOKEN_${response.status}`);
  return body;
}

async function linkedinUserInfo(accessToken: string) {
  const response = await fetch("https://api.linkedin.com/v2/userinfo", { headers: { authorization: `Bearer ${accessToken}` } });
  const body = await response.json() as { sub?: string; name?: string; given_name?: string; family_name?: string; error_description?: string };
  if (!response.ok || !body.sub) throw new Error(body.error_description || `LINKEDIN_USERINFO_${response.status}`);
  return { id: body.sub, name: body.name || [body.given_name, body.family_name].filter(Boolean).join(" ") || "Profilo LinkedIn" };
}

async function linkedinOrganizations(accessToken: string, env: SocialEnv): Promise<Candidate[]> {
  const url = new URL("https://api.linkedin.com/rest/organizationAcls");
  url.searchParams.set("q", "roleAssignee");
  url.searchParams.set("role", "ADMINISTRATOR");
  url.searchParams.set("state", "APPROVED");
  url.searchParams.set("projection", "(elements*(*,organization~(localizedName)))");
  const response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}`, "X-Restli-Protocol-Version": "2.0.0", "Linkedin-Version": linkedinVersion(env) } });
  const body = await response.json() as { elements?: Array<{ organization?: string; "organization~"?: { localizedName?: string } }>; message?: string };
  if (!response.ok) throw new Error(body.message || `LINKEDIN_ORGS_${response.status}`);
  return (body.elements ?? []).flatMap((entry) => {
    const urn = entry.organization;
    if (!urn) return [];
    const id = urn.split(":").pop();
    if (!id) return [];
    return [{ id, name: entry["organization~"]?.localizedName || `Pagina ${id}`, kind: "ORGANIZATION" }];
  });
}

async function googleExchange(code: string, callbackUri: string, env: SocialEnv) {
  const form = new URLSearchParams({
    code,
    client_id: env.GOOGLE_CLIENT_ID!,
    client_secret: env.GOOGLE_CLIENT_SECRET!,
    redirect_uri: callbackUri,
    grant_type: "authorization_code",
  });
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form });
  const body = await response.json() as { access_token?: string; expires_in?: number; refresh_token?: string; error_description?: string };
  if (!response.ok || !body.access_token) throw new Error(body.error_description || `GOOGLE_TOKEN_${response.status}`);
  return body;
}

async function googleLocations(accessToken: string): Promise<Candidate[]> {
  const headers = { authorization: `Bearer ${accessToken}` };
  const accounts: Array<{ name?: string; accountName?: string }> = [];
  let accountPageToken: string | undefined;
  for (let page = 0; page < 3 && accounts.length < 50; page += 1) {
    const accountUrl = new URL("https://mybusinessaccountmanagement.googleapis.com/v1/accounts");
    accountUrl.searchParams.set("pageSize", "20");
    if (accountPageToken) accountUrl.searchParams.set("pageToken", accountPageToken);
    const { body } = await googleApiJson<{ accounts?: Array<{ name?: string; accountName?: string }>; nextPageToken?: string }>(accountUrl, headers);
    accounts.push(...(body.accounts ?? []));
    accountPageToken = body.nextPageToken;
    if (!accountPageToken) break;
  }
  const candidates: Candidate[] = [];
  for (const account of accounts.slice(0, 50)) {
    if (!account.name) continue;
    let locationPageToken: string | undefined;
    for (let page = 0; page < 2 && candidates.length < 100; page += 1) {
      const locationUrl = new URL(`https://mybusinessbusinessinformation.googleapis.com/v1/${account.name}/locations`);
      locationUrl.searchParams.set("readMask", "name,title,storefrontAddress,metadata");
      locationUrl.searchParams.set("pageSize", "100");
      if (locationPageToken) locationUrl.searchParams.set("pageToken", locationPageToken);
      try {
        const { body } = await googleApiJson<{ locations?: Array<{ name?: string; title?: string; storefrontAddress?: { locality?: string; administrativeArea?: string } }>; nextPageToken?: string }>(locationUrl, headers);
        for (const location of body.locations ?? []) {
          if (!location.name) continue;
          const locality = [location.storefrontAddress?.locality, location.storefrontAddress?.administrativeArea].filter(Boolean).join(", ");
          candidates.push({ id: location.name, accountId: account.name, name: locality ? `${location.title || location.name} · ${locality}` : location.title || location.name, kind: "LOCATION" });
          if (candidates.length >= 100) break;
        }
        locationPageToken = body.nextPageToken;
        if (!locationPageToken) break;
      } catch (reason) {
        if (reason instanceof Error && reason.message === "GBP_RATE_LIMITED") throw reason;
        break;
      }
    }
  }
  return candidates;
}

async function handleConnect(request: Request, env: SocialEnv) {
  if (request.method !== "POST") return socialJson({ error: "METHOD_NOT_ALLOWED" }, 405);
  const token = bearer(request);
  if (!token) return socialJson({ error: "AUTH_REQUIRED" }, 401);
  const body = await readBody(request);
  const profileId = typeof body.profileId === "string" ? body.profileId : "";
  const provider = body.provider;
  if (!profileId || !isProvider(provider)) return socialJson({ error: "PROFILE_AND_PROVIDER_REQUIRED" }, 400);
  const missingConfiguration = missingProviderConfiguration(provider, env);
  if (missingConfiguration.length) return socialJson({ error: "PROVIDER_NOT_CONFIGURED", provider, detail: `Mancano sul server: ${missingConfiguration.join(", ")}.` }, 503);
  if (!await canAccessProfile(profileId, token)) return socialJson({ error: "PROFILE_NOT_FOUND" }, 404);
  const callbackUri = `${baseUrl(env, request.url)}/api/social/callback/${provider.toLowerCase()}`;
  const state = await createOAuthState({ provider, profileId, callbackUri }, env.SOCIAL_TOKEN_KEY!);
  const authorization = buildAuthorizationUrl(provider, env, state, callbackUri);
  return socialJson({ provider, url: authorization.url, callbackUri, scopes: authorization.scopes });
}

async function handleCallback(request: Request, env: SocialEnv, providerFromPath: string) {
  const provider = providerFromPath.toUpperCase();
  if (!isProvider(provider)) return socialJson({ error: "PROVIDER_INVALID" }, 404);
  if (!providerConfigured(provider, env)) return socialJson({ error: "PROVIDER_NOT_CONFIGURED" }, 503);
  const url = new URL(request.url);
  const stateValue = url.searchParams.get("state") || "";
  let state: OAuthState;
  try { state = await verifyOAuthState(stateValue, env.SOCIAL_TOKEN_KEY!); }
  catch (reason) { return socialJson({ error: reason instanceof Error ? reason.message : "OAUTH_STATE_INVALID" }, 400); }
  if (state.provider !== provider) return socialJson({ error: "OAUTH_PROVIDER_MISMATCH" }, 400);
  if (url.searchParams.get("error")) return oauthRedirect(state, { social_error: url.searchParams.get("error_description") || url.searchParams.get("error") || "AUTH_DENIED" });
  const code = url.searchParams.get("code");
  if (!code) return oauthRedirect(state, { social_error: "AUTH_CODE_MISSING" });
  const sql = neon(env.DATABASE_URL!);
  const claim = await claimOAuthCallback(sql, state);
  if (!claim.claimed) {
    if (claim.status === "COMPLETED" && Object.keys(claim.result).length) return oauthRedirect(state, claim.result);
    return oauthRedirect(state, { social_error: claim.status === "PROCESSING" ? "OAUTH_CALLBACK_IN_PROGRESS" : "OAUTH_CALLBACK_ALREADY_USED" });
  }
  try {
    if (provider === "FACEBOOK" || provider === "INSTAGRAM") {
      const token = await metaLongUserToken(code, state.callbackUri, env);
      const pages = await metaPages(token.accessToken, env);
      const candidates = metaCandidates(provider, pages);
      if (!candidates.length) throw new Error(provider === "INSTAGRAM" ? "NESSUN_ACCOUNT_INSTAGRAM_PROFESSIONALE_COLLEGATO_A_UNA_PAGINA" : "NESSUNA_PAGINA_FACEBOOK_GESTIBILE");
      const tokenReference = await encryptTokenBundle({ accessToken: token.accessToken, expiresAt: token.expiresIn ? new Date(Date.now() + token.expiresIn * 1000).toISOString() : null, kind: "meta_user_pending" }, env.SOCIAL_TOKEN_KEY!);
      await upsertConnection(sql, { profileId: state.profileId, provider, status: "PENDING_SELECTION", tokenReference, permissions: providerScopes(provider, env), metadata: { candidates } });
      const result = { selection: provider };
      await finishOAuthCallback(sql, state, "COMPLETED", result);
      return oauthRedirect(state, result);
    }

    if (provider === "LINKEDIN") {
      const token = await linkedinExchange(code, state.callbackUri, env);
      const expiresAt = token.expires_in ? new Date(Date.now() + token.expires_in * 1000).toISOString() : null;
      const tokenReference = await encryptTokenBundle({ accessToken: token.access_token!, refreshToken: token.refresh_token ?? null, expiresAt, kind: "linkedin" }, env.SOCIAL_TOKEN_KEY!);
      if (linkedinOrganizationMode(env)) {
        const candidates = await linkedinOrganizations(token.access_token!, env);
        if (!candidates.length) throw new Error("NESSUNA_PAGINA_LINKEDIN_AMMINISTRATA_O_ACCESSO_COMMUNITY_MANAGEMENT_NON_ATTIVO");
        await upsertConnection(sql, { profileId: state.profileId, provider, status: "PENDING_SELECTION", tokenReference, permissions: providerScopes(provider, env), expiresAt, metadata: { candidates, accountType: "ORGANIZATION" } });
        const result = { selection: provider };
        await finishOAuthCallback(sql, state, "COMPLETED", result);
        return oauthRedirect(state, result);
      }
      const member = await linkedinUserInfo(token.access_token!);
      await upsertConnection(sql, { profileId: state.profileId, provider, status: "ACTIVE", providerAccountId: member.id, accountName: member.name, tokenReference, permissions: providerScopes(provider, env), expiresAt, metadata: { accountType: "MEMBER" } });
      const result = { connected: provider };
      await finishOAuthCallback(sql, state, "COMPLETED", result);
      return oauthRedirect(state, result);
    }

    const token = await googleExchange(code, state.callbackUri, env);
    const expiresAt = token.expires_in ? new Date(Date.now() + token.expires_in * 1000).toISOString() : null;
    const tokenReference = await encryptTokenBundle({ accessToken: token.access_token!, refreshToken: token.refresh_token ?? null, expiresAt, kind: "google" }, env.SOCIAL_TOKEN_KEY!);
    const candidates = await googleLocations(token.access_token!);
    if (!candidates.length) throw new Error("NESSUNA_SEDE_GOOGLE_BUSINESS_PROFILE_ACCESSIBILE_O_QUOTA_API_NON_ATTIVA");
    await upsertConnection(sql, { profileId: state.profileId, provider, status: "PENDING_SELECTION", tokenReference, permissions: [GOOGLE_SCOPE], expiresAt, metadata: { candidates } });
    const result = { selection: provider };
    await finishOAuthCallback(sql, state, "COMPLETED", result);
    return oauthRedirect(state, result);
  } catch (reason) {
    const errorCode = reason instanceof Error ? reason.message : "SOCIAL_OAUTH_FAILED";
    await finishOAuthCallback(sql, state, "FAILED", {}, errorCode).catch(() => undefined);
    console.error("social-oauth-callback", { provider, errorCode });
    return oauthRedirect(state, { social_error: errorCode });
  }
}

async function handleStatus(request: Request, env: SocialEnv) {
  if (request.method !== "GET") return socialJson({ error: "METHOD_NOT_ALLOWED" }, 405);
  const token = bearer(request);
  if (!token) return socialJson({ error: "AUTH_REQUIRED" }, 401);
  const profileId = new URL(request.url).searchParams.get("profileId") || "";
  if (!profileId) return socialJson({ error: "PROFILE_REQUIRED" }, 400);
  const access = await profileAccess(profileId, token);
  if (access.upstreamStatus !== null) {
    console.error("social-profile-access-failed", { profileId, upstreamStatus: access.upstreamStatus });
    return socialJson({ error: "PROFILE_ACCESS_CHECK_FAILED", upstreamStatus: access.upstreamStatus }, 502);
  }
  if (!access.allowed) return socialJson({ error: "PROFILE_NOT_FOUND" }, 404);
  const response = await dataApi(`social_connections?profile_id=eq.${encodeURIComponent(profileId)}&select=provider,status,provider_account_id,account_name,permissions,expires_at,metadata,last_validated_at,updated_at`, token);
  if (!response.ok) return socialJson({ error: `SOCIAL_CONNECTIONS_${response.status}` }, 502);
  const rows = await response.json() as ConnectionRow[];
  const byProvider = new Map(rows.map((row) => [row.provider, row]));
  return socialJson({
    providers: PROVIDERS.map((provider) => {
      const row = byProvider.get(provider);
      const metadata = connectionMetadata(row?.metadata);
      return {
        provider,
        configured: providerConfigured(provider, env),
        status: row?.status ?? "NOT_CONNECTED",
        accountId: row?.provider_account_id ?? null,
        accountName: row?.account_name ?? null,
        permissions: Array.isArray(row?.permissions) ? row.permissions : [],
        expiresAt: row?.expires_at ?? null,
        lastValidatedAt: row?.last_validated_at ?? null,
        candidates: row?.status === "PENDING_SELECTION" ? safeCandidates(metadata.candidates) : [],
        accountType: typeof metadata.accountType === "string" ? metadata.accountType : null,
        capabilities: providerCapabilities(provider),
      };
    }),
    linkedinOrganizationMode: linkedinOrganizationMode(env),
    publishingBaseUrlConfigured: Boolean(env.APP_BASE_URL),
  });
}

async function handleSelect(request: Request, env: SocialEnv) {
  if (request.method !== "POST") return socialJson({ error: "METHOD_NOT_ALLOWED" }, 405);
  const auth = bearer(request);
  if (!auth) return socialJson({ error: "AUTH_REQUIRED" }, 401);
  const body = await readBody(request);
  const profileId = typeof body.profileId === "string" ? body.profileId : "";
  const candidateId = typeof body.candidateId === "string" ? body.candidateId : "";
  const provider = body.provider;
  if (!profileId || !candidateId || !isProvider(provider)) return socialJson({ error: "SELECTION_REQUIRED" }, 400);
  if (!await canAccessProfile(profileId, auth)) return socialJson({ error: "PROFILE_NOT_FOUND" }, 404);
  if (!env.DATABASE_URL || !env.SOCIAL_TOKEN_KEY) return socialJson({ error: "SOCIAL_SECURITY_NOT_CONFIGURED" }, 503);
  const sql = neon(env.DATABASE_URL);
  const row = await storedConnection(sql, profileId, provider);
  if (!row?.token_reference || row.status !== "PENDING_SELECTION") return socialJson({ error: "NO_PENDING_SELECTION" }, 409);
  try {
    const bundle = await decryptTokenBundle(row.token_reference, env.SOCIAL_TOKEN_KEY);
    if (provider === "FACEBOOK" || provider === "INSTAGRAM") {
      await activateMetaCandidate(sql, { profileId, provider }, bundle.accessToken, candidateId, env);
    } else if (provider === "LINKEDIN") {
      if (!linkedinOrganizationMode(env)) return socialJson({ error: "LINKEDIN_ORGANIZATION_MODE_DISABLED" }, 409);
      const candidates = await linkedinOrganizations(bundle.accessToken, env);
      const candidate = candidates.find((item) => item.id === candidateId);
      if (!candidate) return socialJson({ error: "SOCIAL_ACCOUNT_NOT_FOUND" }, 404);
      await upsertConnection(sql, { profileId, provider, status: "ACTIVE", providerAccountId: candidate.id, accountName: candidate.name, tokenReference: row.token_reference, permissions: providerScopes(provider, env), expiresAt: row.expires_at, metadata: { accountType: "ORGANIZATION" } });
    } else {
      const candidates = safeCandidates(connectionMetadata(row.metadata).candidates);
      const candidate = candidates.find((item) => item.id === candidateId);
      if (!candidate) return socialJson({ error: "SOCIAL_ACCOUNT_NOT_FOUND" }, 404);
      await upsertConnection(sql, { profileId, provider, status: "ACTIVE", providerAccountId: candidate.id, accountName: candidate.name, tokenReference: row.token_reference, permissions: [GOOGLE_SCOPE], expiresAt: row.expires_at, metadata: { accountId: candidate.accountId, locationName: candidate.id } });
    }
    return socialJson({ connected: true, provider });
  } catch (reason) {
    return socialJson({ error: "SOCIAL_SELECTION_FAILED", detail: reason instanceof Error ? reason.message : "unknown" }, 502);
  }
}

async function handleDisconnect(request: Request, env: SocialEnv) {
  if (request.method !== "POST") return socialJson({ error: "METHOD_NOT_ALLOWED" }, 405);
  const auth = bearer(request);
  if (!auth) return socialJson({ error: "AUTH_REQUIRED" }, 401);
  const body = await readBody(request);
  const profileId = typeof body.profileId === "string" ? body.profileId : "";
  const provider = body.provider;
  if (!profileId || !isProvider(provider)) return socialJson({ error: "PROFILE_AND_PROVIDER_REQUIRED" }, 400);
  if (!await canAccessProfile(profileId, auth)) return socialJson({ error: "PROFILE_NOT_FOUND" }, 404);
  if (!env.DATABASE_URL) return socialJson({ error: "DATABASE_NOT_CONFIGURED" }, 503);
  const sql = neon(env.DATABASE_URL);
  await sql`update public.social_connections set status='NOT_CONNECTED', provider_account_id=null, account_name=null, token_reference=null, permissions='[]'::jsonb, expires_at=null, metadata='{}'::jsonb, last_validated_at=now(), updated_at=now() where profile_id=${profileId}::uuid and provider=${provider}`;
  return socialJson({ disconnected: true, provider });
}

async function refreshGoogleToken(bundle: TokenBundle, env: SocialEnv): Promise<TokenBundle> {
  if (!bundle.expiresAt || new Date(bundle.expiresAt).getTime() > Date.now() + 5 * 60_000) return bundle;
  if (!bundle.refreshToken) throw new Error("GOOGLE_RECONNECT_REQUIRED");
  const form = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID!, client_secret: env.GOOGLE_CLIENT_SECRET!, refresh_token: bundle.refreshToken, grant_type: "refresh_token" });
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form });
  const body = await response.json() as { access_token?: string; expires_in?: number; error_description?: string };
  if (!response.ok || !body.access_token) throw new Error(body.error_description || `GOOGLE_REFRESH_${response.status}`);
  return { ...bundle, accessToken: body.access_token, expiresAt: body.expires_in ? new Date(Date.now() + body.expires_in * 1000).toISOString() : bundle.expiresAt };
}

function composeCaption(variant: VariantRecord) {
  const tags = Array.isArray(variant.hashtags) ? variant.hashtags.filter((item): item is string => typeof item === "string").map((item) => item.startsWith("#") ? item : `#${item.replace(/^#+/, "")}`) : [];
  return [variant.hook, variant.caption, variant.cta, tags.length ? tags.join(" ") : null].filter((part): part is string => Boolean(part?.trim())).join("\n\n").trim();
}

function dataUrlBytes(value: string) {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(value);
  if (!match) throw new Error("ASSET_DATA_URL_INVALID");
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return { mimeType: match[1], bytes };
}

async function assetBytes(storageUrl: string, fallbackMime = "image/png") {
  if (storageUrl.startsWith("data:")) return dataUrlBytes(storageUrl);
  const response = await fetch(storageUrl);
  if (!response.ok) throw new Error(`ASSET_FETCH_${response.status}`);
  return { mimeType: response.headers.get("content-type") || fallbackMime, bytes: new Uint8Array(await response.arrayBuffer()) };
}

function bytesBody(bytes: Uint8Array) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function mediaSignature(profileId: string, assetId: string, exp: number, secret: string) {
  return hmac(`media:${profileId}:${assetId}:${exp}`, secret);
}

async function publicMediaUrl(profileId: string, assetId: string, env: SocialEnv) {
  const root = baseUrl(env);
  if (!root) throw new Error("APP_BASE_URL_NOT_CONFIGURED");
  const exp = Date.now() + 20 * 60_000;
  const sig = await mediaSignature(profileId, assetId, exp, env.SOCIAL_TOKEN_KEY!);
  return `${root}/api/social/media/${encodeURIComponent(assetId)}?profile=${encodeURIComponent(profileId)}&exp=${exp}&sig=${encodeURIComponent(sig)}`;
}

async function handleMedia(request: Request, env: SocialEnv, assetId: string) {
  if (!env.DATABASE_URL || !env.SOCIAL_TOKEN_KEY) return socialJson({ error: "SOCIAL_SECURITY_NOT_CONFIGURED" }, 503);
  const url = new URL(request.url);
  const profileId = url.searchParams.get("profile") || "";
  const exp = Number(url.searchParams.get("exp"));
  const sig = url.searchParams.get("sig") || "";
  if (!/^[0-9a-f-]{36}$/i.test(profileId) || !Number.isFinite(exp) || exp < Date.now() || sig !== await mediaSignature(profileId, assetId, exp, env.SOCIAL_TOKEN_KEY)) return socialJson({ error: "MEDIA_LINK_INVALID" }, 403);
  const sql = neon(env.DATABASE_URL);
  const rows = await sql`select storage_url, mime_type from public.assets where id=${assetId}::uuid and profile_id=${profileId}::uuid limit 1` as unknown as Array<{ storage_url: string; mime_type: string | null }>;
  const asset = rows[0];
  if (!asset?.storage_url) return socialJson({ error: "ASSET_NOT_FOUND" }, 404);
  try {
    const data = await assetBytes(asset.storage_url, asset.mime_type || "image/png");
    return new Response(bytesBody(data.bytes), { status: 200, headers: { "content-type": data.mimeType, "cache-control": "public, max-age=600" } });
  } catch (reason) {
    return socialJson({ error: "ASSET_READ_FAILED", detail: reason instanceof Error ? reason.message : "unknown" }, 502);
  }
}

async function publishInstagram(variant: VariantRecord, connection: StoredConnection, bundle: TokenBundle, env: SocialEnv, beforeVisibleWrite?: PublishBoundary): Promise<PublishResult> {
  if (!variant.image_asset_id) throw new Error("INSTAGRAM_REQUIRES_MEDIA");
  if (variant.format === "CAROUSEL") throw new Error("CAROUSEL_REQUIRES_MULTIPLE_MEDIA_ASSETS");
  if (variant.format !== "POST" && variant.format !== "STORY") throw new Error("FORMAT_NOT_SUPPORTED");
  const mediaUrl = await publicMediaUrl(variant.profile_id, variant.image_asset_id, env);
  const form = new URLSearchParams({ image_url: mediaUrl, access_token: bundle.accessToken });
  if (variant.format === "POST") form.set("caption", composeCaption(variant));
  if (variant.format === "STORY") form.set("media_type", "STORIES");
  const create = await providerRequest(`https://graph.facebook.com/${metaVersion(env)}/${connection.provider_account_id}/media`, { method: "POST", body: form }, { provider: "INSTAGRAM", stage: "MEDIA_CREATE" });
  const createBody = await providerJson<{ id?: string }>(create, "INSTAGRAM", "MEDIA_CREATE", false);
  if (!createBody.id) throw classifyProviderFailure("INSTAGRAM", "MEDIA_CREATE", null, false);
  const publish = await providerRequest(`https://graph.facebook.com/${metaVersion(env)}/${connection.provider_account_id}/media_publish`, { method: "POST", body: new URLSearchParams({ creation_id: createBody.id, access_token: bundle.accessToken }) }, { provider: "INSTAGRAM", stage: "PUBLISH", visibleWrite: true, beforeVisibleWrite });
  const publishBody = await providerJson<{ id?: string }>(publish, "INSTAGRAM", "PUBLISH", true);
  if (!publishBody.id) throw classifyProviderFailure("INSTAGRAM", "PUBLISH", null, true);
  return { externalId: publishBody.id, metadata: { containerId: createBody.id } };
}

async function publishFacebook(variant: VariantRecord, connection: StoredConnection, bundle: TokenBundle, env: SocialEnv, beforeVisibleWrite?: PublishBoundary): Promise<PublishResult> {
  if (variant.format !== "POST") throw new Error("FACEBOOK_FORMAT_REQUIRES_ADDITIONAL_MEDIA_ASSETS");
  const pageId = connection.provider_account_id;
  if (!pageId) throw new Error("FACEBOOK_PAGE_MISSING");
  const caption = composeCaption(variant);
  const endpoint = variant.image_asset_id ? "photos" : "feed";
  const form = new URLSearchParams({ access_token: bundle.accessToken });
  if (variant.image_asset_id) {
    form.set("url", await publicMediaUrl(variant.profile_id, variant.image_asset_id, env));
    form.set("caption", caption);
  } else form.set("message", caption);
  const response = await providerRequest(`https://graph.facebook.com/${metaVersion(env)}/${pageId}/${endpoint}`, { method: "POST", body: form }, { provider: "FACEBOOK", stage: "PUBLISH", visibleWrite: true, beforeVisibleWrite });
  const body = await providerJson<{ id?: string; post_id?: string }>(response, "FACEBOOK", "PUBLISH", true);
  const externalId = body.post_id || body.id;
  if (!externalId) throw classifyProviderFailure("FACEBOOK", "PUBLISH", null, true);
  return { externalId };
}

async function publishLinkedIn(variant: VariantRecord, connection: StoredConnection, bundle: TokenBundle, env: SocialEnv, beforeVisibleWrite?: PublishBoundary): Promise<PublishResult> {
  if (variant.format !== "POST") throw new Error("LINKEDIN_FORMAT_NOT_SUPPORTED");
  if (connection.expires_at && new Date(connection.expires_at).getTime() <= Date.now()) throw new Error("LINKEDIN_RECONNECT_REQUIRED");
  const accountType = connectionMetadata(connection.metadata).accountType === "ORGANIZATION" ? "organization" : "person";
  const author = `urn:li:${accountType}:${connection.provider_account_id}`;
  const headers = { authorization: `Bearer ${bundle.accessToken}`, "Linkedin-Version": linkedinVersion(env), "X-Restli-Protocol-Version": "2.0.0", "content-type": "application/json" };
  let content: Record<string, unknown> | undefined;
  if (variant.image_asset_id && variant.storage_url) {
    const initialize = await providerRequest("https://api.linkedin.com/rest/images?action=initializeUpload", { method: "POST", headers, body: JSON.stringify({ initializeUploadRequest: { owner: author } }) }, { provider: "LINKEDIN", stage: "IMAGE_INIT" });
    const initBody = await providerJson<{ value?: { uploadUrl?: string; image?: string } }>(initialize, "LINKEDIN", "IMAGE_INIT", false);
    if (!initBody.value?.uploadUrl || !initBody.value.image) throw classifyProviderFailure("LINKEDIN", "IMAGE_INIT", null, false);
    const media = await assetBytes(variant.storage_url, variant.mime_type || "image/png");
    await providerRequest(initBody.value.uploadUrl, { method: "PUT", headers: { "content-type": media.mimeType }, body: bytesBody(media.bytes) }, { provider: "LINKEDIN", stage: "IMAGE_UPLOAD" });
    content = { media: { id: initBody.value.image, altText: variant.alt_text || "" } };
  }
  const postBody: Record<string, unknown> = {
    author,
    commentary: composeCaption(variant),
    visibility: "PUBLIC",
    distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };
  if (content) postBody.content = content;
  const response = await providerRequest("https://api.linkedin.com/rest/posts", { method: "POST", headers, body: JSON.stringify(postBody) }, { provider: "LINKEDIN", stage: "PUBLISH", visibleWrite: true, beforeVisibleWrite });
  const externalId = response.headers.get("x-restli-id");
  if (!response.ok || !externalId) {
    throw classifyProviderFailure("LINKEDIN", "PUBLISH", null, true);
  }
  return { externalId };
}

async function publishGoogle(variant: VariantRecord, connection: StoredConnection, bundle: TokenBundle, env: SocialEnv, sql: Sql, beforeVisibleWrite?: PublishBoundary): Promise<PublishResult> {
  if (variant.format !== "POST") throw new Error("GBP_ONLY_SUPPORTS_LOCAL_POSTS");
  const refreshed = await refreshGoogleToken(bundle, env);
  if (refreshed.accessToken !== bundle.accessToken) {
    const encrypted = await encryptTokenBundle(refreshed, env.SOCIAL_TOKEN_KEY!);
    await sql`update public.social_connections set token_reference=${encrypted}, expires_at=${refreshed.expiresAt ?? null}::timestamptz, last_validated_at=now(), updated_at=now() where profile_id=${variant.profile_id}::uuid and provider='GBP'`;
  }
  const metadata = connectionMetadata(connection.metadata);
  const accountId = typeof metadata.accountId === "string" ? metadata.accountId.replace(/^accounts\//, "") : "";
  const locationName = typeof metadata.locationName === "string" ? metadata.locationName : connection.provider_account_id || "";
  const locationId = locationName.replace(/^locations\//, "");
  if (!accountId || !locationId) throw new Error("GBP_LOCATION_MISSING");
  const payload: Record<string, unknown> = { languageCode: "it-IT", summary: composeCaption(variant).slice(0, 1500), topicType: "STANDARD" };
  if (variant.image_asset_id) payload.media = [{ mediaFormat: "PHOTO", sourceUrl: await publicMediaUrl(variant.profile_id, variant.image_asset_id, env) }];
  const response = await providerRequest(`https://mybusiness.googleapis.com/v4/accounts/${encodeURIComponent(accountId)}/locations/${encodeURIComponent(locationId)}/localPosts`, { method: "POST", headers: { authorization: `Bearer ${refreshed.accessToken}`, "content-type": "application/json" }, body: JSON.stringify(payload) }, { provider: "GBP", stage: "PUBLISH", visibleWrite: true, beforeVisibleWrite });
  const body = await providerJson<{ name?: string }>(response, "GBP", "PUBLISH", true);
  if (!body.name) throw classifyProviderFailure("GBP", "PUBLISH", null, true);
  return { externalId: body.name };
}

async function loadVariant(sql: Sql, variantId: string, profileId: string): Promise<VariantRecord | null> {
  const rows = await sql`
    select v.id, v.content_id, v.profile_id, v.provider, v.format, v.caption, v.hook, v.cta, v.hashtags, v.alt_text, v.image_asset_id, v.approval_status, v.eligible,
           a.storage_url, a.mime_type
    from public.content_variants v
    left join public.assets a on a.id = v.image_asset_id and a.profile_id = v.profile_id
    where v.id=${variantId}::uuid and v.profile_id=${profileId}::uuid
    limit 1
  ` as unknown as VariantRecord[];
  return rows[0] ?? null;
}

async function publishVariant(sql: Sql, variant: VariantRecord, env: SocialEnv, beforeVisibleWrite?: PublishBoundary): Promise<PublishResult> {
  if (variant.approval_status !== "APPROVED" || !variant.eligible) throw new Error("CONTENT_NOT_APPROVED");
  const connection = await storedConnection(sql, variant.profile_id, variant.provider);
  if (!connection || connection.status !== "ACTIVE" || !connection.token_reference || !connection.provider_account_id) throw new Error("SOCIAL_NOT_CONNECTED");
  const bundle = await decryptTokenBundle(connection.token_reference, env.SOCIAL_TOKEN_KEY!);
  if (variant.provider === "INSTAGRAM") return publishInstagram(variant, connection, bundle, env, beforeVisibleWrite);
  if (variant.provider === "FACEBOOK") return publishFacebook(variant, connection, bundle, env, beforeVisibleWrite);
  if (variant.provider === "LINKEDIN") return publishLinkedIn(variant, connection, bundle, env, beforeVisibleWrite);
  return publishGoogle(variant, connection, bundle, env, sql, beforeVisibleWrite);
}

export async function handleSocialApi(request: Request, env: SocialEnv): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path === "/api/social/status") return handleStatus(request, env);
  if (path === "/api/social/connect") return handleConnect(request, env);
  if (path === "/api/social/select") return handleSelect(request, env);
  if (path === "/api/social/disconnect") return handleDisconnect(request, env);
  if (path === "/api/social/publish-now") return socialJson({ error: "PUBLISH_VIA_CALENDAR_REQUIRED" }, 410);
  const callback = /^\/api\/social\/callback\/([a-z]+)$/.exec(path);
  if (callback) return handleCallback(request, env, callback[1]);
  const media = /^\/api\/social\/media\/([0-9a-f-]{36})$/i.exec(path);
  if (media) return handleMedia(request, env, media[1]);
  return null;
}

function providerPublishCapability(provider: SocialProvider): CapabilityKey {
  return `social.${provider.toLowerCase()}.publish` as CapabilityKey;
}

async function failClaim(sql: Sql, job: JobRecord, error: SocialPublishError, usageEventId: string | null) {
  const retryAfter = retryDelaySeconds(job.id, job.attempt_count);
  const rows = await sql`
    select public.fail_publication_job(
      ${job.id}::uuid, ${job.claim_token}::uuid, ${error.code}, ${error.customerMessage},
      ${error.retryable}, ${error.outcomeUnknown}, ${retryAfter}, ${usageEventId}::uuid
    ) result
  ` as unknown as Array<{ result: "RETRY_SCHEDULED" | "BLOCKED_APPROVAL" | "OUTCOME_UNKNOWN" | "FAILED" | "STALE_CLAIM" }>;
  return rows[0]?.result ?? "STALE_CLAIM";
}

async function processJob(sql: Sql, job: JobRecord, env: SocialEnv) {
  let usageEventId: string | null = null;
  try {
    const meter = new EntitlementUsageService(env.DATABASE_URL!);
    const scheduled = await meter.canUseCapability(job.profile_id, "social.publish.scheduled");
    if (!scheduled.allowed) throw terminalPublishError("CAPABILITY_SCHEDULED_DISABLED");
    const capabilityKey = providerPublishCapability(job.provider);
    const reservation = await meter.reserveUsage({
      profileId: job.profile_id,
      capabilityKey,
      quantity: 1,
      idempotencyKey: `publication:v1:${job.id}`,
      source: "SCHEDULED_PUBLICATION",
      referenceId: job.id,
      metadata: { logical_unit: 1, execution_state: "JOB_CLAIMED", job_id: job.id, provider: job.provider },
    });
    if (!reservation.allowed || !reservation.result?.event_id) throw terminalPublishError(reservation.reason || "CAPABILITY_PROVIDER_DISABLED");
    usageEventId = reservation.result.event_id;
    if (reservation.result.duplicate) {
      const event = await meter.getUsageEvent(usageEventId);
      if (!event || event.state !== "RESERVED") throw terminalPublishError("PUBLICATION_METERING_INVALID");
    }
    const attached = await sql`
      select public.attach_publication_usage_event(${job.id}::uuid,${job.claim_token}::uuid,${usageEventId}::uuid) attached
    ` as unknown as Array<{ attached: boolean }>;
    if (attached[0]?.attached !== true) {
      await meter.releaseUsage(usageEventId).catch(() => undefined);
      return { skipped: true };
    }

    const variant = await loadVariant(sql, job.variant_id, job.profile_id);
    if (!variant) throw terminalPublishError("CONTENT_VARIANT_NOT_FOUND");
    const beforeVisibleWrite = async () => {
      const rows = await sql`select public.mark_publication_request_started(${job.id}::uuid,${job.claim_token}::uuid) started` as unknown as Array<{ started: boolean }>;
      if (rows[0]?.started !== true) {
        const current = await loadVariant(sql, job.variant_id, job.profile_id);
        if (!current || current.approval_status !== "APPROVED" || !current.eligible) throw terminalPublishError("CONTENT_NOT_APPROVED");
        throw publishError("STALE_PUBLICATION_CLAIM", { outcomeUnknown: false, customerMessage: "La pubblicazione è stata presa in carico da un altro processo." });
      }
    };
    const result = await publishVariant(sql, variant, env, beforeVisibleWrite);
    const completed = await sql`
      select public.complete_publication_job(
        ${job.id}::uuid,${job.claim_token}::uuid,${result.externalId},${JSON.stringify(result.metadata ?? {})}::jsonb,${usageEventId}::uuid
      ) completed
    ` as unknown as Array<{ completed: boolean }>;
    if (completed[0]?.completed !== true) return { published: false, reviewRequired: true, error: "PROVIDER_OUTCOME_UNKNOWN" };
    return { published: true, externalId: result.externalId };
  } catch (reason) {
    const error = reason instanceof SocialPublishError
      ? reason
      : terminalPublishError(reason instanceof Error ? reason.message : "SOCIAL_PUBLISH_FAILED");
    if (error.code === "STALE_PUBLICATION_CLAIM") return { skipped: true };
    const outcome = await failClaim(sql, job, error, usageEventId);
    return { published: false, reviewRequired: outcome === "OUTCOME_UNKNOWN", retryScheduled: outcome === "RETRY_SCHEDULED", error: error.code };
  }
}

export async function processDuePublications(env: SocialEnv, limit = 20) {
  if (!env.DATABASE_URL || !env.SOCIAL_TOKEN_KEY) return { ready: false, reason: "SOCIAL_SECURITY_NOT_CONFIGURED", checked: 0, published: 0, failed: 0 };
  const sql = neon(env.DATABASE_URL);
  const jobs = await sql`
    select job_id::text id, profile_id::text, variant_id::text, provider, scheduled_at::text,
      attempt_no attempt_count, claim_token::text, lease_expires_at::text
    from public.claim_due_publication_jobs(${Math.min(Math.max(limit, 1), 50)},600)
  ` as unknown as JobRecord[];
  let published = 0;
  let failed = 0;
  let retryScheduled = 0;
  let reviewRequired = 0;
  for (const job of jobs) {
    const result = await processJob(sql, job, env);
    if ("published" in result && result.published) published += 1;
    else if ("published" in result && result.published === false) {
      failed += 1;
      if (result.retryScheduled) retryScheduled += 1;
      if (result.reviewRequired) reviewRequired += 1;
    }
  }
  return { ready: true, checked: jobs.length, published, failed, retryScheduled, reviewRequired };
}
