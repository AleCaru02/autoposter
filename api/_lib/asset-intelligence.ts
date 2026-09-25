export type ReusableAssetCandidate = {
  id: string;
  source: string;
  kind: string;
  name: string;
  storage_url: string;
  mime_type: string | null;
  tags: unknown;
  metadata: unknown;
  created_at?: string;
};

export type ReusableAssetMatch = {
  asset: ReusableAssetCandidate;
  score: number;
  reason: "EXACT_VISUAL_FINGERPRINT" | "REAL_ASSET_MATCH" | "AI_ASSET_MATCH";
};

function clean(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[^a-z0-9à-ÿ]+/gi, " ").replace(/\s+/g, " ").trim();
}

function object(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function terms(value: string) {
  return new Set(clean(value).split(" ").filter((item) => item.length >= 3));
}

function similarity(left: Set<string>, right: Set<string>) {
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  for (const term of left) if (right.has(term)) overlap += 1;
  return overlap / (left.size + right.size - overlap);
}

export async function visualFingerprint(input: { visualBrief: string; aspectRatio: string }) {
  const source = JSON.stringify({ visualBrief: clean(input.visualBrief), aspectRatio: input.aspectRatio });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function textForAsset(asset: ReusableAssetCandidate) {
  const metadata = object(asset.metadata);
  return [asset.name, ...strings(asset.tags), metadata.visual_brief, metadata.alt_text, metadata.description]
    .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
    .join(" ");
}

function isRealAsset(asset: ReusableAssetCandidate) {
  const source = asset.source.toUpperCase();
  return !source.includes("AI") && !source.includes("OPENAI") && !source.includes("GENERATED");
}

function hasCompatibleAspect(asset: ReusableAssetCandidate, requestedAspectRatio: string) {
  const aspect = object(asset.metadata).aspect_ratio;
  // An unclassified real photo can be used only for square content; Story assets require an explicit compatible crop.
  return typeof aspect === "string" ? aspect === requestedAspectRatio : requestedAspectRatio === "1:1" && isRealAsset(asset);
}

/** Chooses only a genuinely suitable asset. It never reserves budget or calls an image provider. */
export async function findReusableAsset(input: { visualBrief: string; aspectRatio: string; candidates: ReusableAssetCandidate[] }): Promise<ReusableAssetMatch | null> {
  const fingerprint = await visualFingerprint({ visualBrief: input.visualBrief, aspectRatio: input.aspectRatio });
  const desired = terms(input.visualBrief);
  const matches: ReusableAssetMatch[] = [];

  for (const asset of input.candidates) {
    if (asset.kind !== "IMAGE" || !asset.storage_url || !hasCompatibleAspect(asset, input.aspectRatio)) continue;
    const metadata = object(asset.metadata);
    if (metadata.visual_fingerprint === fingerprint) {
      matches.push({ asset, score: 1, reason: "EXACT_VISUAL_FINGERPRINT" });
      continue;
    }
    const candidateTerms = terms(textForAsset(asset));
    if (desired.size < 4 || candidateTerms.size < 4) continue;
    const score = similarity(desired, candidateTerms);
    const real = isRealAsset(asset);
    if (score < (real ? 0.72 : 0.82)) continue;
    matches.push({ asset, score: score + (real ? 0.04 : 0), reason: real ? "REAL_ASSET_MATCH" : "AI_ASSET_MATCH" });
  }

  matches.sort((a, b) => b.score - a.score || String(b.asset.created_at ?? "").localeCompare(String(a.asset.created_at ?? "")));
  return matches[0] ?? null;
}
