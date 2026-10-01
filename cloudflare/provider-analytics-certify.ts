import { neon } from "@neondatabase/serverless";
import { AnalyticsProviderError, fetchProviderMetrics } from "../api/_lib/analytics.js";
import { metricsCapability } from "../api/_lib/social-metrics.js";
import { socialSafeModeState, type SocialEnv } from "../api/_lib/social.js";

type Provider = "FACEBOOK" | "INSTAGRAM" | "LINKEDIN";
type Env = SocialEnv & {
  DATABASE_URL?: string;
  SOCIAL_TOKEN_KEY?: string;
  PROVIDER_ANALYTICS_QA_TOKEN?: string;
};

type Candidate = {
  job_id: string;
  profile_id: string;
  variant_id: string;
  content_id: string;
  provider: Provider;
  external_post_id: string;
  format: string;
  topic: string;
  published_at: string;
  account_name: string | null;
  status: string;
  provider_account_id: string | null;
  token_reference: string | null;
  permissions: unknown;
  expires_at: string | null;
  metadata: unknown;
};

type ProviderCall = {
  endpoint: string;
  metric: string | null;
  fields: string | null;
  queryType: string | null;
  method: "GET";
  status: number;
  rawNumericFields: Record<string, number>;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function metadata(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function authorized(request: Request, env: Env) {
  const expected = env.PROVIDER_ANALYTICS_QA_TOKEN?.trim();
  return Boolean(expected) && request.headers.get("x-provider-analytics-qa-token")?.trim() === expected;
}

function numericLeaves(value: unknown, prefix = "", depth = 0, target: Record<string, number> = {}) {
  if (depth > 6 || Object.keys(target).length >= 40) return target;
  if (typeof value === "number" && Number.isFinite(value)) {
    if (prefix) target[prefix] = value;
    return target;
  }
  if (typeof value === "string" && value.trim() && /^-?\d+(?:\.\d+)?$/.test(value.trim())) {
    if (prefix) target[prefix] = Number(value);
    return target;
  }
  if (Array.isArray(value)) {
    value.slice(0, 10).forEach((item, index) => numericLeaves(item, prefix ? `${prefix}.${index}` : String(index), depth + 1, target));
    return target;
  }
  if (!value || typeof value !== "object") return target;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (/token|secret|cursor|paging|url/i.test(key)) continue;
    numericLeaves(child, prefix ? `${prefix}.${key}` : key, depth + 1, target);
  }
  return target;
}

function capability(candidate: Candidate) {
  const info = metadata(candidate.metadata);
  if (candidate.status !== "ACTIVE") return { available: false, reason: "SOCIAL_NOT_CONNECTED" };
  if (!candidate.provider_account_id || !candidate.token_reference) return { available: false, reason: "SOCIAL_CONNECTION_INCOMPLETE" };
  if (candidate.expires_at && new Date(candidate.expires_at).getTime() <= Date.now()) return { available: false, reason: `${candidate.provider}_TOKEN_EXPIRED` };
  return metricsCapability({
    provider: candidate.provider,
    connectionStatus: candidate.status,
    providerAccountId: candidate.provider_account_id,
    permissions: candidate.permissions,
    linkedinOrganizationMode: info.accountType === "ORGANIZATION",
  });
}

async function loadCandidates(databaseUrl: string) {
  const sql = neon(databaseUrl);
  return await sql`
    select
      j.id::text as job_id,
      j.profile_id::text as profile_id,
      j.variant_id::text as variant_id,
      v.content_id::text as content_id,
      j.provider,
      j.remote_post_id as external_post_id,
      v.format,
      ci.topic,
      coalesce(j.published_at,v.published_at,j.updated_at)::text as published_at,
      sc.account_name,
      sc.status,
      sc.provider_account_id,
      sc.token_reference,
      sc.permissions,
      sc.expires_at::text as expires_at,
      sc.metadata
    from public.publication_jobs j
    join public.content_variants v
      on v.id=j.variant_id and v.profile_id=j.profile_id
    join public.content_items ci
      on ci.id=v.content_id and ci.profile_id=j.profile_id
    left join public.social_connections sc
      on sc.profile_id=j.profile_id and sc.provider=j.provider
    where j.state='PUBLISHED'
      and j.remote_post_id is not null
      and btrim(j.remote_post_id)<>''
      and j.provider in ('FACEBOOK','INSTAGRAM','LINKEDIN')
      and coalesce(j.published_at,v.published_at,j.updated_at) >= clock_timestamp()-interval '30 days'
    order by
      coalesce(j.published_at,v.published_at,j.updated_at) desc,
      case j.provider when 'FACEBOOK' then 0 when 'INSTAGRAM' then 1 else 2 end,
      j.id
    limit 50
  ` as unknown as Candidate[];
}

export async function handleProviderAnalyticsCertification(request: Request, env: Env) {
  if (!env.PROVIDER_ANALYTICS_QA_TOKEN) return json({ error: "API_NOT_FOUND" }, 404);
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  if (!authorized(request, env)) return json({ error: "API_NOT_FOUND" }, 404);
  if (socialSafeModeState(env) !== "ON") return json({ error: "SAFE_MODE_REQUIRED" }, 409);
  if (!env.DATABASE_URL || !env.SOCIAL_TOKEN_KEY) return json({ error: "ANALYTICS_SECURITY_NOT_CONFIGURED" }, 503);

  const candidates = await loadCandidates(env.DATABASE_URL);
  if (!candidates.length) {
    return json({
      error: "BLOCKED_NO_REMOTE_POST",
      safeMode: true,
      requestType: "READ_ONLY",
      externalWrite: false,
    }, 409);
  }

  const evaluated = candidates.map((candidate) => ({ candidate, capability: capability(candidate) }));
  const selected = evaluated.find((item) => item.capability.available);
  if (!selected) {
    return json({
      error: "BLOCKED_PROVIDER_AUTH",
      safeMode: true,
      requestType: "READ_ONLY",
      externalWrite: false,
      providers: [...new Set(evaluated.map((item) => item.candidate.provider))],
      reasons: [...new Set(evaluated.map((item) => item.capability.reason).filter(Boolean))],
    }, 409);
  }

  const candidate = selected.candidate;
  const providerCalls: ProviderCall[] = [];
  const readOnlyFetch: typeof fetch = async (input, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    if (method !== "GET" || init?.body) {
      throw new AnalyticsProviderError(
        "ANALYTICS_CERT_EXTERNAL_WRITE_BLOCKED",
        false,
        "BLOCKED",
        "La certificazione analytics consente esclusivamente letture provider.",
      );
    }

    const url = new URL(String(input));
    if (!["graph.facebook.com", "api.linkedin.com"].includes(url.hostname)) {
      throw new AnalyticsProviderError(
        "ANALYTICS_CERT_PROVIDER_HOST_BLOCKED",
        false,
        "BLOCKED",
        "Host provider non consentito per la certificazione analytics.",
      );
    }

    const response = await fetch(input, init);
    let rawNumericFields: Record<string, number> = {};
    try {
      rawNumericFields = numericLeaves(await response.clone().json());
    } catch {
      rawNumericFields = {};
    }
    providerCalls.push({
      endpoint: url.pathname,
      metric: url.searchParams.get("metric"),
      fields: url.searchParams.get("fields"),
      queryType: url.searchParams.get("queryType"),
      method: "GET",
      status: response.status,
      rawNumericFields,
    });
    return response;
  };

  try {
    const metrics = await fetchProviderMetrics(
      {
        job_id: candidate.job_id,
        profile_id: candidate.profile_id,
        variant_id: candidate.variant_id,
        content_id: candidate.content_id,
        provider: candidate.provider,
        external_post_id: candidate.external_post_id,
        format: candidate.format,
        topic: candidate.topic,
        published_at: candidate.published_at,
        claim_token: "provider-analytics-certification-read-only",
        lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
      {
        status: candidate.status,
        provider_account_id: candidate.provider_account_id,
        token_reference: candidate.token_reference,
        permissions: candidate.permissions,
        expires_at: candidate.expires_at,
        metadata: candidate.metadata,
      },
      env,
      { fetch: readOnlyFetch, timeoutMs: 20_000 },
    );

    if (!Object.keys(metrics).length) {
      throw new AnalyticsProviderError(
        `${candidate.provider}_ANALYTICS_EMPTY`,
        true,
        null,
        "Il social non ha restituito metriche utilizzabili.",
      );
    }

    return json({
      certified: true,
      safeMode: true,
      requestType: "READ_ONLY",
      externalWrite: false,
      provider: candidate.provider,
      account: candidate.account_name ?? candidate.provider_account_id,
      mapping: {
        contentId: candidate.content_id,
        publicationJobId: candidate.job_id,
        variantId: candidate.variant_id,
        externalPostId: candidate.external_post_id,
        providerAccountId: candidate.provider_account_id,
        publishedAt: candidate.published_at,
      },
      metricsNormalized: metrics,
      providerCalls,
    });
  } catch (reason) {
    const error = reason instanceof AnalyticsProviderError
      ? reason
      : new AnalyticsProviderError("ANALYTICS_CERT_TEMPORARY", true, null, "Analytics temporaneamente non verificabili.");
    console.error("provider-analytics-certification", {
      provider: candidate.provider,
      publicationJobId: candidate.job_id,
      code: error.code,
      retryable: error.retryable,
      terminalState: error.terminalState,
    });
    return json({
      error: error.code,
      retryable: error.retryable,
      terminalState: error.terminalState,
      safeMode: true,
      requestType: "READ_ONLY",
      externalWrite: false,
      provider: candidate.provider,
      account: candidate.account_name ?? candidate.provider_account_id,
      mapping: {
        contentId: candidate.content_id,
        publicationJobId: candidate.job_id,
        variantId: candidate.variant_id,
        externalPostId: candidate.external_post_id,
      },
      providerCalls,
    }, error.retryable ? 503 : 409);
  }
}
