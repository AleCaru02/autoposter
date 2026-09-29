import { authenticatedApiToken } from "../../lib/auth-token";

export type PersonalBrandSourceRow = {
  id: string;
  personal_brand_profile_id: string;
  source_profile_id: string;
  source_name?: string;
  source_industry?: string | null;
  enabled: boolean;
  pillar: string;
  allowed_topics: string[];
  allowed_claims: string[];
  allowed_ctas: string[];
  asset_policy: "NO_ASSETS" | "REFERENCE_ONLY" | "REUSE_APPROVED";
  weight: number;
  priority: number;
  created_at: string;
  updated_at: string;
};

function textList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim())
    : [];
}

function normalize(row: Record<string, unknown>): PersonalBrandSourceRow {
  return {
    id: String(row.id),
    personal_brand_profile_id: String(row.personal_brand_profile_id),
    source_profile_id: String(row.source_profile_id),
    source_name: typeof row.source_name === "string" ? row.source_name : undefined,
    source_industry: typeof row.source_industry === "string" ? row.source_industry : null,
    enabled: row.enabled !== false,
    pillar: String(row.pillar ?? ""),
    allowed_topics: textList(row.allowed_topics),
    allowed_claims: textList(row.allowed_claims),
    allowed_ctas: textList(row.allowed_ctas),
    asset_policy: (["NO_ASSETS","REFERENCE_ONLY","REUSE_APPROVED"].includes(String(row.asset_policy))
      ? String(row.asset_policy)
      : "REFERENCE_ONLY") as PersonalBrandSourceRow["asset_policy"],
    weight: Number(row.weight ?? 1),
    priority: Number(row.priority ?? 100),
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
  };
}

async function api(path: string, init?: RequestInit) {
  const token = await authenticatedApiToken();
  const response = await fetch(path, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "PERSONAL_BRAND_SOURCE_API_FAILED");
  return body;
}

export async function loadPersonalBrandSources(personalBrandProfileId: string): Promise<PersonalBrandSourceRow[]> {
  const body = await api(`/api/personal-brand/sources?profileId=${encodeURIComponent(personalBrandProfileId)}`);
  const rows = Array.isArray(body.sources) ? body.sources : [];
  return (rows as Record<string, unknown>[]).map(normalize);
}

export async function savePersonalBrandSource(input: {
  personalBrandProfileId: string;
  sourceProfileId: string;
}) {
  return api("/api/personal-brand/sources", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function deletePersonalBrandSource(personalBrandProfileId: string, id: string) {
  await api("/api/personal-brand/sources", {
    method: "DELETE",
    body: JSON.stringify({ personalBrandProfileId, id }),
  });
}
