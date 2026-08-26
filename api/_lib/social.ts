import { neon } from "@neondatabase/serverless";

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
  refreshToken?: string | null;
  expiresAt?: string | null;
  kind?: string;
};

type Candidate = {
  id: string;
  name: string;
  accountId?: string;
  pageId?: string;
  username?: string;
  kind?: string;
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
};

type PublishResult = { externalId: string; metadata?: Record<string, unknown> };

type Sql = ReturnType<typeof neon>;

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

export function providerConfigured(provider: SocialProvider, env: SocialEnv) {
  const securityReady = Boolean(env.DATABASE_URL && env.SOCIAL_TOKEN_KEY && env.SOCIAL_TOKEN_KEY.length >= 24);
  if (!securityReady) return false;
  if (provider === "FACEBOOK" || provider === "INSTAGRAM") return Boolean(env.META_APP_ID && env.META_APP_SECRET);
  if (provider === "LINKEDIN") return Boolean(env.LINKEDIN_CLIENT_ID && env.LINKEDIN_CLIENT_SECRET);
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
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

async function canAccessProfile(profileId: string, token: string) {
  const response = await dataApi(`profiles?id=eq.${encodeURIComponent(profileId)}&select=id&limit=1`, token);
  if (!response.ok) return false;
  const rows = await response.json() as Array<{ id?: string }>;
  return rows.some((row) => row.id === profileId);
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
  providerAccountId?: string | null;
  accountName?: string | null;
  tokenReference?: string | null;
  permissions?: string[];
  expiresAt?: string | null;
  metadata?: Record<string, unknown>;
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
  const accountsResponse = await fetch("https://mybusinessaccountmanagement.googleapis.com/v1/accounts?pageSize=100", { headers });
  const accountsBody = await accountsResponse.json() as { accounts?: Array<{ name?: string; accountName?: string }>; error?: { message?: string } };
  if (!accountsResponse.ok) throw new Error(accountsBody.error?.message || `GBP_ACCOUNTS_${accountsResponse.status}`);
  const candidates: Candidate[] = [];
  for (const account of (accountsBody.accounts ?? []).slice(0, 50)) {
    if (!account.name) continue;
    const locationUrl = new URL(`https://mybusinessbusinessinformation.googleapis.com/v1/${account.name}/locations`);
    locationUrl.searchParams.set("readMask", "name,title,storefrontAddress,metadata");
    locationUrl.searchParams.set("pageSize", "100");
    const response = await fetch(locationUrl, { headers });
    if (!response.ok) continue;
    const body = await response.json() as { locations?: Array<{ name?: string; title?: string; storefrontAddress?: { locality?: string; administrativeArea?: string } }> };
    for (const location of body.locations ?? []) {
      if (!location.name) continue;
      const locality = [location.storefrontAddress?.locality, location.storefrontAddress?.administrativeArea].filter(Boolean).join(", ");
      candidates.push({ id: location.name, accountId: account.name, name: locality ? `${location.title || location.name} · ${locality}` : location.title || location.name, kind: "LOCATION" });
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
  if (!providerConfigured(provider, env)) return socialJson({ error: "PROVIDER_NOT_CONFIGURED", provider }, 503);
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
  try {
    const sql = neon(env.DATABASE_URL!);
    if (provider === "FACEBOOK" || provider === "INSTAGRAM") {
      const token = await metaLongUserToken(code, state.callbackUri, env);
      const pages = await metaPages(token.accessToken, env);
      const candidates = metaCandidates(provider, pages);
      if (!candidates.length) throw new Error(provider === "INSTAGRAM" ? "NESSUN_ACCOUNT_INSTAGRAM_PROFESSIONALE_COLLEGATO_A_UNA_PAGINA" : "NESSUNA_PAGINA_FACEBOOK_GESTIBILE");
      if (candidates.length === 1) {
        await activateMetaCandidate(sql, state, token.accessToken, candidates[0].id, env);
        return oauthRedirect(state, { connected: provider });
      }
      const tokenReference = await encryptTokenBundle({ accessToken: token.accessToken, expiresAt: token.expiresIn ? new Date(Date.now() + token.expiresIn * 1000).toISOString() : null, kind: "meta_user_pending" }, env.SOCIAL_TOKEN_KEY!);
      await upsertConnection(sql, { profileId: state.profileId, provider, status: "PENDING_SELECTION", tokenReference, permissions: providerScopes(provider, env), metadata: { candidates } });
      return oauthRedirect(state, { selection: provider });
    }

    if (provider === "LINKEDIN") {
      const token = await linkedinExchange(code, state.callbackUri, env);
      const expiresAt = token.expires_in ? new Date(Date.now() + token.expires_in * 1000).toISOString() : null;
      const tokenReference = await encryptTokenBundle({ accessToken: token.access_token!, refreshToken: token.refresh_token ?? null, expiresAt, kind: "linkedin" }, env.SOCIAL_TOKEN_KEY!);
      if (linkedinOrganizationMode(env)) {
        const candidates = await linkedinOrganizations(token.access_token!, env);
        if (!candidates.length) throw new Error("NESSUNA_PAGINA_LINKEDIN_AMMINISTRATA_O_ACCESSO_COMMUNITY_MANAGEMENT_NON_ATTIVO");
        if (candidates.length === 1) {
          await upsertConnection(sql, { profileId: state.profileId, provider, status: "ACTIVE", providerAccountId: candidates[0].id, accountName: candidates[0].name, tokenReference, permissions: providerScopes(provider, env), expiresAt, metadata: { accountType: "ORGANIZATION" } });
          return oauthRedirect(state, { connected: provider });
        }
        await upsertConnection(sql, { profileId: state.profileId, provider, status: "PENDING_SELECTION", tokenReference, permissions: providerScopes(provider, env), expiresAt, metadata: { candidates, accountType: "ORGANIZATION" } });
        return oauthRedirect(state, { selection: provider });
      }
      const member = await linkedinUserInfo(token.access_token!);
      await upsertConnection(sql, { profileId: state.profileId, provider, status: "ACTIVE", providerAccountId: member.id, accountName: member.name, tokenReference, permissions: providerScopes(provider, env), expiresAt, metadata: { accountType: "MEMBER" } });
      return oauthRedirect(state, { connected: provider });
    }

    const token = await googleExchange(code, state.callbackUri, env);
    const expiresAt = token.expires_in ? new Date(Date.now() + token.expires_in * 1000).toISOString() : null;
    const tokenReference = await encryptTokenBundle({ accessToken: token.access_token!, refreshToken: token.refresh_token ?? null, expiresAt, kind: "google" }, env.SOCIAL_TOKEN_KEY!);
    const candidates = await googleLocations(token.access_token!);
    if (!candidates.length) throw new Error("NESSUNA_SEDE_GOOGLE_BUSINESS_PROFILE_ACCESSIBILE_O_QUOTA_API_NON_ATTIVA");
    if (candidates.length === 1) {
      await upsertConnection(sql, { profileId: state.profileId, provider, status: "ACTIVE", providerAccountId: candidates[0].id, accountName: candidates[0].name, tokenReference, permissions: [GOOGLE_SCOPE], expiresAt, metadata: { accountId: candidates[0].accountId, locationName: candidates[0].id } });
      return oauthRedirect(state, { connected: provider });
    }
    await upsertConnection(sql, { profileId: state.profileId, provider, status: "PENDING_SELECTION", tokenReference, permissions: [GOOGLE_SCOPE], expiresAt, metadata: { candidates } });
    return oauthRedirect(state, { selection: provider });
  } catch (reason) {
    console.error("social-oauth-callback", { provider, detail: reason instanceof Error ? reason.message : "unknown" });
    return oauthRedirect(state, { social_error: reason instanceof Error ? reason.message : "SOCIAL_OAUTH_FAILED" });
  }
}

async function handleStatus(request: Request, env: SocialEnv) {
  if (request.method !== "GET") return socialJson({ error: "METHOD_NOT_ALLOWED" }, 405);
  const token = bearer(request);
  if (!token) return socialJson({ error: "AUTH_REQUIRED" }, 401);
  const profileId = new URL(request.url).searchParams.get("profileId") || "";
  if (!profileId || !await canAccessProfile(profileId, token)) return socialJson({ error: "PROFILE_NOT_FOUND" }, 404);
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

async function refreshGoogleToken(bundle: TokenBundle, env: SocialEnv) {
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

async function mediaSignature(assetId: string, exp: number, secret: string) {
  return hmac(`media:${assetId}:${exp}`, secret);
}

async function publicMediaUrl(assetId: string, env: SocialEnv) {
  const root = baseUrl(env);
  if (!root) throw new Error("APP_BASE_URL_NOT_CONFIGURED");
  const exp = Date.now() + 20 * 60_000;
  const sig = await mediaSignature(assetId, exp, env.SOCIAL_TOKEN_KEY!);
  return `${root}/api/social/media/${encodeURIComponent(assetId)}?exp=${exp}&sig=${encodeURIComponent(sig)}`;
}

async function handleMedia(request: Request, env: SocialEnv, assetId: string) {
  if (!env.DATABASE_URL || !env.SOCIAL_TOKEN_KEY) return socialJson({ error: "SOCIAL_SECURITY_NOT_CONFIGURED" }, 503);
  const url = new URL(request.url);
  const exp = Number(url.searchParams.get("exp"));
  const sig = url.searchParams.get("sig") || "";
  if (!Number.isFinite(exp) || exp < Date.now() || sig !== await mediaSignature(assetId, exp, env.SOCIAL_TOKEN_KEY)) return socialJson({ error: "MEDIA_LINK_INVALID" }, 403);
  const sql = neon(env.DATABASE_URL);
  const rows = await sql`select storage_url, mime_type from public.assets where id=${assetId}::uuid limit 1` as unknown as Array<{ storage_url: string; mime_type: string | null }>;
  const asset = rows[0];
  if (!asset?.storage_url) return socialJson({ error: "ASSET_NOT_FOUND" }, 404);
  try {
    const data = await assetBytes(asset.storage_url, asset.mime_type || "image/png");
    return new Response(data.bytes, { status: 200, headers: { "content-type": data.mimeType, "cache-control": "public, max-age=600" } });
  } catch (reason) {
    return socialJson({ error: "ASSET_READ_FAILED", detail: reason instanceof Error ? reason.message : "unknown" }, 502);
  }
}

async function publishInstagram(variant: VariantRecord, connection: StoredConnection, bundle: TokenBundle, env: SocialEnv): Promise<PublishResult> {
  if (!variant.image_asset_id) throw new Error("INSTAGRAM_REQUIRES_MEDIA");
  if (variant.format === "CAROUSEL") throw new Error("CAROUSEL_REQUIRES_MULTIPLE_MEDIA_ASSETS");
  if (variant.format !== "POST" && variant.format !== "STORY") throw new Error("FORMAT_NOT_SUPPORTED");
  const mediaUrl = await publicMediaUrl(variant.image_asset_id, env);
  const form = new URLSearchParams({ image_url: mediaUrl, access_token: bundle.accessToken });
  if (variant.format === "POST") form.set("caption", composeCaption(variant));
  if (variant.format === "STORY") form.set("media_type", "STORIES");
  const create = await fetch(`https://graph.facebook.com/${metaVersion(env)}/${connection.provider_account_id}/media`, { method: "POST", body: form });
  const createBody = await create.json() as { id?: string; error?: { message?: string } };
  if (!create.ok || !createBody.id) throw new Error(createBody.error?.message || `INSTAGRAM_MEDIA_${create.status}`);
  const publish = await fetch(`https://graph.facebook.com/${metaVersion(env)}/${connection.provider_account_id}/media_publish`, { method: "POST", body: new URLSearchParams({ creation_id: createBody.id, access_token: bundle.accessToken }) });
  const publishBody = await publish.json() as { id?: string; error?: { message?: string } };
  if (!publish.ok || !publishBody.id) throw new Error(publishBody.error?.message || `INSTAGRAM_PUBLISH_${publish.status}`);
  return { externalId: publishBody.id, metadata: { containerId: createBody.id } };
}

async function publishFacebook(variant: VariantRecord, connection: StoredConnection, bundle: TokenBundle, env: SocialEnv): Promise<PublishResult> {
  if (variant.format !== "POST") throw new Error("FACEBOOK_FORMAT_REQUIRES_ADDITIONAL_MEDIA_ASSETS");
  const pageId = connection.provider_account_id;
  if (!pageId) throw new Error("FACEBOOK_PAGE_MISSING");
  const caption = composeCaption(variant);
  const endpoint = variant.image_asset_id ? "photos" : "feed";
  const form = new URLSearchParams({ access_token: bundle.accessToken });
  if (variant.image_asset_id) {
    form.set("url", await publicMediaUrl(variant.image_asset_id, env));
    form.set("caption", caption);
  } else form.set("message", caption);
  const response = await fetch(`https://graph.facebook.com/${metaVersion(env)}/${pageId}/${endpoint}`, { method: "POST", body: form });
  const body = await response.json() as { id?: string; post_id?: string; error?: { message?: string } };
  const externalId = body.post_id || body.id;
  if (!response.ok || !externalId) throw new Error(body.error?.message || `FACEBOOK_PUBLISH_${response.status}`);
  return { externalId };
}

async function publishLinkedIn(variant: VariantRecord, connection: StoredConnection, bundle: TokenBundle, env: SocialEnv): Promise<PublishResult> {
  if (variant.format !== "POST") throw new Error("LINKEDIN_FORMAT_NOT_SUPPORTED");
  if (connection.expires_at && new Date(connection.expires_at).getTime() <= Date.now()) throw new Error("LINKEDIN_RECONNECT_REQUIRED");
  const accountType = connectionMetadata(connection.metadata).accountType === "ORGANIZATION" ? "organization" : "person";
  const author = `urn:li:${accountType}:${connection.provider_account_id}`;
  const headers = { authorization: `Bearer ${bundle.accessToken}`, "Linkedin-Version": linkedinVersion(env), "X-Restli-Protocol-Version": "2.0.0", "content-type": "application/json" };
  let content: Record<string, unknown> | undefined;
  if (variant.image_asset_id && variant.storage_url) {
    const initialize = await fetch("https://api.linkedin.com/rest/images?action=initializeUpload", { method: "POST", headers, body: JSON.stringify({ initializeUploadRequest: { owner: author } }) });
    const initBody = await initialize.json() as { value?: { uploadUrl?: string; image?: string }; message?: string };
    if (!initialize.ok || !initBody.value?.uploadUrl || !initBody.value.image) throw new Error(initBody.message || `LINKEDIN_IMAGE_INIT_${initialize.status}`);
    const media = await assetBytes(variant.storage_url, variant.mime_type || "image/png");
    const upload = await fetch(initBody.value.uploadUrl, { method: "PUT", headers: { "content-type": media.mimeType }, body: media.bytes });
    if (!upload.ok) throw new Error(`LINKEDIN_IMAGE_UPLOAD_${upload.status}`);
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
  const response = await fetch("https://api.linkedin.com/rest/posts", { method: "POST", headers, body: JSON.stringify(postBody) });
  const externalId = response.headers.get("x-restli-id");
  if (!response.ok || !externalId) {
    const body = await response.json().catch(() => ({})) as { message?: string };
    throw new Error(body.message || `LINKEDIN_PUBLISH_${response.status}`);
  }
  return { externalId };
}

async function publishGoogle(variant: VariantRecord, connection: StoredConnection, bundle: TokenBundle, env: SocialEnv, sql: Sql): Promise<PublishResult> {
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
  if (variant.image_asset_id) payload.media = [{ mediaFormat: "PHOTO", sourceUrl: await publicMediaUrl(variant.image_asset_id, env) }];
  const response = await fetch(`https://mybusiness.googleapis.com/v4/accounts/${encodeURIComponent(accountId)}/locations/${encodeURIComponent(locationId)}/localPosts`, { method: "POST", headers: { authorization: `Bearer ${refreshed.accessToken}`, "content-type": "application/json" }, body: JSON.stringify(payload) });
  const body = await response.json() as { name?: string; error?: { message?: string } };
  if (!response.ok || !body.name) throw new Error(body.error?.message || `GBP_PUBLISH_${response.status}`);
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

async function publishVariant(sql: Sql, variant: VariantRecord, env: SocialEnv): Promise<PublishResult> {
  if (variant.approval_status !== "APPROVED" || !variant.eligible) throw new Error("CONTENT_NOT_APPROVED");
  const connection = await storedConnection(sql, variant.profile_id, variant.provider);
  if (!connection || connection.status !== "ACTIVE" || !connection.token_reference || !connection.provider_account_id) throw new Error("SOCIAL_NOT_CONNECTED");
  const bundle = await decryptTokenBundle(connection.token_reference, env.SOCIAL_TOKEN_KEY!);
  if (variant.provider === "INSTAGRAM") return publishInstagram(variant, connection, bundle, env);
  if (variant.provider === "FACEBOOK") return publishFacebook(variant, connection, bundle, env);
  if (variant.provider === "LINKEDIN") return publishLinkedIn(variant, connection, bundle, env);
  return publishGoogle(variant, connection, bundle, env, sql);
}

async function handlePublishNow(request: Request, env: SocialEnv) {
  if (request.method !== "POST") return socialJson({ error: "METHOD_NOT_ALLOWED" }, 405);
  const auth = bearer(request);
  if (!auth) return socialJson({ error: "AUTH_REQUIRED" }, 401);
  const body = await readBody(request);
  const profileId = typeof body.profileId === "string" ? body.profileId : "";
  const variantId = typeof body.variantId === "string" ? body.variantId : "";
  if (!profileId || !variantId) return socialJson({ error: "PROFILE_AND_VARIANT_REQUIRED" }, 400);
  if (!await canAccessProfile(profileId, auth)) return socialJson({ error: "PROFILE_NOT_FOUND" }, 404);
  if (!env.DATABASE_URL || !env.SOCIAL_TOKEN_KEY) return socialJson({ error: "SOCIAL_SECURITY_NOT_CONFIGURED" }, 503);
  const sql = neon(env.DATABASE_URL);
  const variant = await loadVariant(sql, variantId, profileId);
  if (!variant) return socialJson({ error: "CONTENT_VARIANT_NOT_FOUND" }, 404);
  try {
    const result = await publishVariant(sql, variant, env);
    const now = new Date().toISOString();
    await sql`update public.content_variants set external_post_id=${result.externalId}, published_at=${now}::timestamptz, updated_at=${now}::timestamptz where id=${variant.id}::uuid and profile_id=${profileId}::uuid`;
    return socialJson({ published: true, externalId: result.externalId });
  } catch (reason) {
    return socialJson({ error: "SOCIAL_PUBLISH_FAILED", detail: reason instanceof Error ? reason.message : "unknown" }, 502);
  }
}

export async function handleSocialApi(request: Request, env: SocialEnv): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path === "/api/social/status") return handleStatus(request, env);
  if (path === "/api/social/connect") return handleConnect(request, env);
  if (path === "/api/social/select") return handleSelect(request, env);
  if (path === "/api/social/disconnect") return handleDisconnect(request, env);
  if (path === "/api/social/publish-now") return handlePublishNow(request, env);
  const callback = /^\/api\/social\/callback\/([a-z]+)$/.exec(path);
  if (callback) return handleCallback(request, env, callback[1]);
  const media = /^\/api\/social\/media\/([0-9a-f-]{36})$/i.exec(path);
  if (media) return handleMedia(request, env, media[1]);
  return null;
}

async function recordAttempt(sql: Sql, job: JobRecord, attemptNo: number, state: string, input: { externalId?: string; error?: string; metadata?: Record<string, unknown> }) {
  const metadata = JSON.stringify(input.metadata ?? {});
  await sql`
    insert into public.publication_attempts
      (job_id, profile_id, provider, attempt_no, state, provider_request_id, error_code, error_message, response_metadata, started_at, finished_at)
    values
      (${job.id}::uuid, ${job.profile_id}::uuid, ${job.provider}, ${attemptNo}, ${state}, ${input.externalId ?? null}, ${input.error ? "PROVIDER_ERROR" : null}, ${input.error ?? null}, ${metadata}::jsonb, now(), now())
  `;
}

async function processJob(sql: Sql, job: JobRecord, env: SocialEnv) {
  const locked = await sql`
    update public.publication_jobs
    set state='PROCESSING', locked_at=now(), updated_at=now()
    where id=${job.id}::uuid and state='SCHEDULED' and scheduled_at <= now()
    returning id
  ` as unknown as Array<{ id: string }>;
  if (!locked[0]) return { skipped: true };
  const attemptNo = job.attempt_count + 1;
  try {
    const variant = await loadVariant(sql, job.variant_id, job.profile_id);
    if (!variant) throw new Error("CONTENT_VARIANT_NOT_FOUND");
    const result = await publishVariant(sql, variant, env);
    await recordAttempt(sql, job, attemptNo, "SUCCESS", { externalId: result.externalId, metadata: result.metadata });
    await sql`update public.publication_jobs set state='PUBLISHED', attempt_count=${attemptNo}, locked_at=null, last_error=null, updated_at=now() where id=${job.id}::uuid`;
    await sql`update public.content_variants set external_post_id=${result.externalId}, published_at=now(), updated_at=now() where id=${job.variant_id}::uuid and profile_id=${job.profile_id}::uuid`;
    return { published: true, externalId: result.externalId };
  } catch (reason) {
    const error = (reason instanceof Error ? reason.message : "SOCIAL_PUBLISH_FAILED").slice(0, 1000);
    await recordAttempt(sql, job, attemptNo, "FAILED", { error });
    if (attemptNo >= 3 || error.includes("RECONNECT_REQUIRED") || error === "SOCIAL_NOT_CONNECTED" || error.includes("FORMAT_")) {
      await sql`update public.publication_jobs set state='FAILED', attempt_count=${attemptNo}, locked_at=null, last_error=${error}, updated_at=now() where id=${job.id}::uuid`;
    } else {
      await sql`update public.publication_jobs set state='SCHEDULED', scheduled_at=now() + interval '15 minutes', attempt_count=${attemptNo}, locked_at=null, last_error=${error}, updated_at=now() where id=${job.id}::uuid`;
    }
    return { published: false, error };
  }
}

export async function processDuePublications(env: SocialEnv, limit = 20) {
  if (!env.DATABASE_URL || !env.SOCIAL_TOKEN_KEY) return { ready: false, reason: "SOCIAL_SECURITY_NOT_CONFIGURED", checked: 0, published: 0, failed: 0 };
  const sql = neon(env.DATABASE_URL);
  const jobs = await sql`
    select id, profile_id, variant_id, provider, scheduled_at, attempt_count
    from public.publication_jobs
    where state='SCHEDULED' and scheduled_at <= now()
    order by scheduled_at asc
    limit ${Math.min(Math.max(limit, 1), 50)}
  ` as unknown as JobRecord[];
  let published = 0;
  let failed = 0;
  for (const job of jobs) {
    const result = await processJob(sql, job, env);
    if ("published" in result && result.published) published += 1;
    else if ("published" in result && result.published === false) failed += 1;
  }
  return { ready: true, checked: jobs.length, published, failed };
}
