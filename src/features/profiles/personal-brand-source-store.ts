import { neonClient } from "../../lib/neon-client";

export type PersonalBrandSourceRow = {
  id: string;
  personal_brand_profile_id: string;
  source_profile_id: string;
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
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()) : [];
}

function normalize(row: Record<string, unknown>): PersonalBrandSourceRow {
  return {
    id: String(row.id),
    personal_brand_profile_id: String(row.personal_brand_profile_id),
    source_profile_id: String(row.source_profile_id),
    enabled: row.enabled !== false,
    pillar: String(row.pillar ?? ""),
    allowed_topics: textList(row.allowed_topics),
    allowed_claims: textList(row.allowed_claims),
    allowed_ctas: textList(row.allowed_ctas),
    asset_policy: (["NO_ASSETS","REFERENCE_ONLY","REUSE_APPROVED"].includes(String(row.asset_policy)) ? String(row.asset_policy) : "REFERENCE_ONLY") as PersonalBrandSourceRow["asset_policy"],
    weight: Number(row.weight ?? 1),
    priority: Number(row.priority ?? 100),
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
  };
}

export async function loadPersonalBrandSources(personalBrandProfileId: string): Promise<PersonalBrandSourceRow[]> {
  const result = await neonClient.from("personal_brand_sources")
    .select("id,personal_brand_profile_id,source_profile_id,enabled,pillar,allowed_topics,allowed_claims,allowed_ctas,asset_policy,weight,priority,created_at,updated_at")
    .eq("personal_brand_profile_id", personalBrandProfileId)
    .order("priority", { ascending: true })
    .order("created_at", { ascending: true });
  if (result.error) throw new Error("Impossibile caricare le fonti del Personal Brand.");
  return ((result.data ?? []) as Record<string, unknown>[]).map(normalize);
}

export async function savePersonalBrandSource(input: {
  id?: string | null;
  personalBrandProfileId: string;
  sourceProfileId: string;
  enabled: boolean;
  pillar: string;
  allowedTopics: string[];
  allowedClaims: string[];
  allowedCtas: string[];
  assetPolicy: PersonalBrandSourceRow["asset_policy"];
  weight: number;
  priority: number;
}) {
  const payload = {
    personal_brand_profile_id: input.personalBrandProfileId,
    source_profile_id: input.sourceProfileId,
    enabled: input.enabled,
    pillar: input.pillar.trim(),
    allowed_topics: input.allowedTopics,
    allowed_claims: input.allowedClaims,
    allowed_ctas: input.allowedCtas,
    asset_policy: input.assetPolicy,
    weight: Math.min(Math.max(input.weight || 1, 0.001), 100),
    priority: Math.min(Math.max(Math.round(input.priority || 0), 0), 10000),
    updated_at: new Date().toISOString(),
  };
  if (!payload.pillar) throw new Error("Il pillar è obbligatorio.");

  const query = input.id
    ? neonClient.from("personal_brand_sources").update(payload).eq("id", input.id).eq("personal_brand_profile_id", input.personalBrandProfileId)
    : neonClient.from("personal_brand_sources").insert(payload);
  const result = await query.select("id,personal_brand_profile_id,source_profile_id,enabled,pillar,allowed_topics,allowed_claims,allowed_ctas,asset_policy,weight,priority,created_at,updated_at").single();
  if (result.error || !result.data) throw new Error("Fonte non salvata. Controlla che attività e pillar non siano già collegati.");
  return normalize(result.data as Record<string, unknown>);
}

export async function deletePersonalBrandSource(personalBrandProfileId: string, id: string) {
  const result = await neonClient.from("personal_brand_sources").delete().eq("id", id).eq("personal_brand_profile_id", personalBrandProfileId).select("id");
  if (result.error) throw new Error("Impossibile rimuovere la fonte.");
}
