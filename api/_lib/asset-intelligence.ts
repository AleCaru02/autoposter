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

function terms(value: string) {
  return new Set(clean(value).split(" ").filter((item) => item.length >= 3));
}

function jaccard(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  for (const item of a) if (b.has(item)) overlap += 1;
  return overlap / (a.size + b.size - overlap);
}

function object(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export async function visualFingerprint(input: { visualBrief: string; aspectRatio: string }) {
  const canonical = JSON.stringify({ visualBrief: clean(input.visualBrief), aspectRatio: input.aspectRatio });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function candidateText(asset: ReusableAssetCandidate) {
  const metadata = object(asset.metadata);
  return [
    asset.name,
    ...strings(asset.tags),
    typeof metadata.visual_brief === "string" ? metadata.visual_brief : "",
    typeof metadata.alt_text === "string" ? metadata.alt_text : "",
    typeof metadata.description === "string" ? metadata.description : "",
  ].filter(Boolean).join(" ");
}

function isRealAsset(asset: ReusableAssetCandidate) {
  const source = asset.source.toUpperCase();
  return !source.includes("AI") && !source.includes("GEMINI") && !source.includes("GPT_IMAGE") && !source.includes("OPENAI");
}

function compatibleAspect(asset: ReusableAssetCandidate, requested: string) {
  const metadata = object(asset.metadata);
  const aspect = typeof metadata.aspect_ratio === "string" ? metadata.aspect_ratio : null;
  return !aspect || aspect === requested;
}

export async function findReusableAsset(input: {
  visualBrief: string;
  aspectRatio: string;
  candidates: ReusableAssetCandidate[];
}): Promise<ReusableAssetMatch | null> {
  const desiredFingerprint = await visualFingerprint({ visualBrief: input.visualBrief, aspectRatio: input.aspectRatio });
  const briefTerms = terms(input.visualBrief);
  const ranked: ReusableAssetMatch[] = [];

  for (const asset of input.candidates) {
    if (asset.kind !== "IMAGE" || !asset.storage_url || !compatibleAspect(asset, input.aspectRatio)) continue;
    const metadata = object(asset.metadata);
    if (metadata.visual_fingerprint === desiredFingerprint) {
      ranked.push({ asset, score: 1, reason: "EXACT_VISUAL_FINGERPRINT" });
      continue;
    }

    const assetTerms = terms(candidateText(asset));
    if (briefTerms.size < 4 || assetTerms.size < 4) continue;
    const similarity = jaccard(briefTerms, assetTerms);
    const threshold = isRealAsset(asset) ? 0.72 : 0.82;
    if (similarity < threshold) continue;
    ranked.push({
      asset,
      score: similarity + (isRealAsset(asset) ? 0.04 : 0),
      reason: isRealAsset(asset) ? "REAL_ASSET_MATCH" : "AI_ASSET_MATCH",
    });
  }

  ranked.sort((a, b) => b.score - a.score || String(b.asset.created_at ?? "").localeCompare(String(a.asset.created_at ?? "")));
  return ranked[0] ?? null;
}
