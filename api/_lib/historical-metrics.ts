import { neon } from "@neondatabase/serverless";
import { decryptTokenBundle, type SocialEnv } from "./social.js";
import { fetchProviderMetrics } from "./analytics.js";

/**
 * Read-only import of REAL metrics for posts the owner already published on Instagram and
 * Facebook (outside Post Automatici). Feeds the learning engine with authentic data before any
 * publication by the app: no publishing, no AI, only provider GET calls with stored tokens.
 *
 * Snapshots are stored as source PROVIDER_API / data_origin PROVIDER_REAL with content_id and
 * job_id NULL (they were not generated here). One snapshot per post per 20 hours.
 */
type Sql = ReturnType<typeof neon>;
type HistoricalProvider = "INSTAGRAM" | "FACEBOOK";
type FetchRuntime = { fetch?: typeof fetch; timeoutMs?: number };
type ConnectionRow = { profile_id: string; provider: HistoricalProvider; status: string; provider_account_id: string | null; token_reference: string | null; permissions: unknown; expires_at: string | null; metadata: unknown };
export type RemotePost = { id: string; caption: string; publishedAt: string; format: "POST" | "CAROUSEL" | "REEL" | "STORY" };

export const HISTORICAL_REFRESH_HOURS = 20;
export const HISTORICAL_POSTS_PER_PROVIDER = 25;

export function historicalMetricsEnabled(value: string | undefined) {
  return value?.trim().toLowerCase() !== "false";
}

/** Topic for learning: first meaningful line of the caption, without hashtags/mentions. */
export function topicFromCaption(caption: string) {
  const firstLine = caption.split(/\r?\n/).map((line) => line.replace(/[#@][\p{L}\p{N}_.]+/gu, "").replace(/\s+/g, " ").trim()).find((line) => line.length >= 3) ?? "";
  return firstLine.slice(0, 140) || "Post senza testo";
}

export function instagramFormat(mediaType: unknown, productType: unknown): RemotePost["format"] {
  if (productType === "REELS" || mediaType === "VIDEO") return "REEL";
  if (productType === "STORY") return "STORY";
  if (mediaType === "CAROUSEL_ALBUM") return "CAROUSEL";
  return "POST";
}

async function getJson(url: URL, token: string, runtime: FetchRuntime) {
  url.searchParams.set("access_token", token);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), runtime.timeoutMs ?? 20_000);
  try {
    const response = await (runtime.fetch ?? fetch)(url, { signal: controller.signal, headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`HISTORICAL_LIST_HTTP_${response.status}`);
    return await response.json() as { data?: Array<Record<string, unknown>> };
  } finally { clearTimeout(timer); }
}

export async function listRecentPosts(connection: ConnectionRow, token: string, env: SocialEnv, runtime: FetchRuntime = {}, limit = HISTORICAL_POSTS_PER_PROVIDER): Promise<RemotePost[]> {
  const version = env.META_GRAPH_VERSION || "v23.0";
  const info = connection.metadata && typeof connection.metadata === "object" ? connection.metadata as Record<string, unknown> : {};
  if (connection.provider === "INSTAGRAM") {
    const url = new URL(`https://graph.facebook.com/${version}/${encodeURIComponent(connection.provider_account_id!)}/media`);
    url.searchParams.set("fields", "id,caption,media_type,media_product_type,timestamp");
    url.searchParams.set("limit", String(limit));
    const body = await getJson(url, token, runtime);
    return (body.data ?? []).filter((item) => typeof item.id === "string" && typeof item.timestamp === "string").map((item) => ({
      id: item.id as string, caption: typeof item.caption === "string" ? item.caption : "", publishedAt: item.timestamp as string,
      format: instagramFormat(item.media_type, item.media_product_type),
    }));
  }
  const pageId = typeof info.pageId === "string" ? info.pageId : connection.provider_account_id!;
  const url = new URL(`https://graph.facebook.com/${version}/${encodeURIComponent(pageId)}/published_posts`);
  url.searchParams.set("fields", "id,message,created_time");
  url.searchParams.set("limit", String(limit));
  const body = await getJson(url, token, runtime);
  return (body.data ?? []).filter((item) => typeof item.id === "string" && typeof item.created_time === "string").map((item) => ({
    id: item.id as string, caption: typeof item.message === "string" ? item.message : "", publishedAt: item.created_time as string, format: "POST" as const,
  }));
}

export async function importHistoricalMetrics(env: SocialEnv, options: { profileId?: string; runtime?: FetchRuntime; sql?: Sql; now?: Date } = {}) {
  const result = { ready: true, connections: 0, posts: 0, synced: 0, withoutMetrics: 0, failed: 0, codes: [] as string[] };
  if (!env.DATABASE_URL || !env.SOCIAL_TOKEN_KEY) return { ...result, ready: false, codes: ["HISTORICAL_SECURITY_NOT_CONFIGURED"] };
  const sql = options.sql ?? neon(env.DATABASE_URL);
  const connections = await sql`
    select c.profile_id::text as profile_id, c.provider, c.status, c.provider_account_id, c.token_reference, c.permissions, c.expires_at, c.metadata
    from public.social_connections c join public.profiles p on p.id=c.profile_id
    where c.status='ACTIVE' and c.provider in ('INSTAGRAM','FACEBOOK') and c.token_reference is not null and c.provider_account_id is not null
      and p.archived_at is null and not public.is_demo_persistent_profile(p.id)
      and (${options.profileId ?? null}::uuid is null or c.profile_id=${options.profileId ?? null}::uuid)
      and not exists (
        select 1 from public.metric_snapshots s
        where s.profile_id=c.profile_id and s.provider=c.provider and s.job_id is null and s.source='PROVIDER_API'
          and s.captured_at > now() - make_interval(hours => ${HISTORICAL_REFRESH_HOURS})
      )
    order by c.profile_id, c.provider limit 20
  ` as unknown as ConnectionRow[];
  for (const connection of connections) {
    result.connections += 1;
    let posts: RemotePost[] = [];
    try {
      const bundle = await decryptTokenBundle(connection.token_reference!, env.SOCIAL_TOKEN_KEY);
      posts = await listRecentPosts(connection, bundle.accessToken, env, options.runtime);
    } catch (reason) {
      result.failed += 1; result.codes.push(`${connection.provider}:${reason instanceof Error ? reason.message.split(":")[0] : "LIST_FAILED"}`);
      continue;
    }
    for (const post of posts) {
      result.posts += 1;
      try {
        const metrics = await fetchProviderMetrics({
          job_id: "", profile_id: connection.profile_id, variant_id: "", content_id: "", provider: connection.provider,
          external_post_id: post.id, format: post.format, topic: topicFromCaption(post.caption), published_at: post.publishedAt, claim_token: "", lease_expires_at: "",
        }, connection, env, options.runtime);
        // The provider returned no counters for this post (e.g. shared or very old Page posts): not an error.
        if (!Object.keys(metrics).length) { result.withoutMetrics += 1; continue; }
        await sql`
          insert into public.metric_snapshots (id, profile_id, provider, content_id, variant_id, job_id, external_post_id, format, topic, published_at, captured_at, metrics, source, data_origin, created_at)
          values (gen_random_uuid(), ${connection.profile_id}::uuid, ${connection.provider}, null, null, null, ${post.id}, ${post.format}, ${topicFromCaption(post.caption)}, ${post.publishedAt}::timestamptz, clock_timestamp(), ${JSON.stringify(metrics)}::jsonb, 'PROVIDER_API', 'PROVIDER_REAL', now())
        `;
        result.synced += 1;
      } catch (reason) {
        result.failed += 1;
        const code = reason instanceof Error ? reason.message.split(":")[0] : "METRICS_FAILED";
        if (!result.codes.includes(`${connection.provider}:${code}`)) result.codes.push(`${connection.provider}:${code}`);
        // Missing permission/reconnect: the rest of this account would fail the same way.
        if (/RECONNECT_REQUIRED|PERMISSION|TOKEN_EXPIRED|SOCIAL_NOT_CONNECTED|MISSING_PERMISSIONS/.test(code)) break;
      }
    }
  }
  result.ready = result.failed === 0;
  return result;
}
