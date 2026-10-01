export const SOURCE_INTELLIGENCE_VERSION = 1;

export type SourceTier =
  | "OFFICIAL"
  | "HELP_CENTER"
  | "TERMS_POLICY"
  | "TECHNICAL_DOCS"
  | "INSTITUTIONAL"
  | "AUTHORITATIVE_EDITORIAL"
  | "SECONDARY"
  | "WEAK";

export type ClaimVerificationStatus =
  | "VERIFIED"
  | "PARTIALLY_VERIFIED"
  | "NEEDS_SOURCE"
  | "CONFLICTING_SOURCES"
  | "UNVERIFIED";

export type SourceRecord = {
  url: string;
  canonicalUrl: string;
  host: string;
  label: string;
  tier: SourceTier;
  rank: number;
  weak: boolean;
  trackingRemoved: boolean;
};

export type ClaimSourceRecord = {
  claim: string;
  sourceUrls: string[];
  sourceType: SourceTier | "NONE";
  verificationStatus: ClaimVerificationStatus;
  checkedAt: string;
};

export type SourceIntelligenceSummary = {
  auditSources: SourceRecord[];
  uiSources: SourceRecord[];
  claims: ClaimSourceRecord[];
};

const TRACKING_KEYS = new Set([
  "aid","sid","label","gclid","fbclid","msclkid","igshid","mc_cid","mc_eid",
  "ref","ref_","source","campaign","campaignid","adgroupid","creative","keyword",
  "utm_source","utm_medium","utm_campaign","utm_term","utm_content","utm_id",
]);

const WEAK_HOSTS = new Set([
  "reddit.com","quora.com","facebook.com","instagram.com","tiktok.com",
  "x.com","twitter.com","pinterest.com","medium.com",
]);

function cleanHost(hostname: string) {
  return hostname.toLowerCase().replace(/^www\./, "");
}

function topicTokens(topic: string) {
  return [...new Set(topic.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4 && !["delle","della","degli","differenze","confronto","versus"].includes(token))
  )];
}

export function normalizeExternalSourceUrl(raw: string) {
  try {
    const url = new URL(raw);
    if (!["http:","https:"].includes(url.protocol)) return null;
    const before = url.toString();
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith("utm_") || TRACKING_KEYS.has(key.toLowerCase())) url.searchParams.delete(key);
    }
    url.hash = "";
    if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/{2,}/g, "/").replace(/\/$/, "");
    const canonicalUrl = url.toString();
    return { canonicalUrl, host: cleanHost(url.hostname), trackingRemoved: canonicalUrl !== before };
  } catch {
    return null;
  }
}

function isInstitutionalHost(host: string) {
  return host === "europa.eu" || host.endsWith(".europa.eu") || host.endsWith(".gov.it")
    || host === "istat.it" || host.endsWith(".istat.it") || host.includes("agenziaentrate.gov.it");
}

function classifySource(url: URL, topic: string): { tier: SourceTier; rank: number; weak: boolean } {
  const host = cleanHost(url.hostname);
  const path = url.pathname.toLowerCase();
  const tokens = topicTokens(topic);
  const officialByTopic = tokens.some((token) => host.includes(token));

  if ([...WEAK_HOSTS].some((weak) => host === weak || host.endsWith("." + weak))) return { tier: "WEAK", rank: 5, weak: true };
  if (/partnership|affiliate|newsletter|image\.email|email\./i.test(host + path)) return { tier: "WEAK", rank: 12, weak: true };
  if (/\.pdf$/i.test(path) && /marketing|partner|partnership|sales|brochure/i.test(path)) return { tier: "WEAK", rank: 15, weak: true };
  if (isInstitutionalHost(host)) return { tier: "INSTITUTIONAL", rank: 92, weak: false };
  if (/\/(?:help|support|hc)(?:\/|$)/i.test(path)) return { tier: "HELP_CENTER", rank: officialByTopic ? 99 : 90, weak: false };
  if (/\/(?:terms|legal|policy|policies|privacy|conditions)(?:\/|$)/i.test(path)) return { tier: "TERMS_POLICY", rank: officialByTopic ? 98 : 89, weak: false };
  if (/\/(?:docs|documentation|developers?|api)(?:\/|$)/i.test(path)) return { tier: "TECHNICAL_DOCS", rank: officialByTopic ? 97 : 88, weak: false };
  if (officialByTopic) return { tier: "OFFICIAL", rank: 96, weak: false };
  if (/\/(?:news|article|articles|insights|research|report)(?:\/|$)/i.test(path)) return { tier: "AUTHORITATIVE_EDITORIAL", rank: 70, weak: false };
  if (/\.pdf$/i.test(path)) return { tier: "SECONDARY", rank: 55, weak: false };
  return { tier: "SECONDARY", rank: 50, weak: false };
}

function sourceLabel(host: string, tier: SourceTier) {
  const labels: Record<SourceTier,string> = {
    OFFICIAL: "Fonte ufficiale",
    HELP_CENTER: "Help Center",
    TERMS_POLICY: "Termini / policy",
    TECHNICAL_DOCS: "Documentazione tecnica",
    INSTITUTIONAL: "Fonte istituzionale",
    AUTHORITATIVE_EDITORIAL: "Fonte editoriale",
    SECONDARY: "Fonte secondaria",
    WEAK: "Fonte debole",
  };
  return host + " · " + labels[tier];
}

export function buildSourceRecords(topic: string, values: string[]) {
  const byCanonical = new Map<string, SourceRecord>();
  for (const raw of values) {
    const normalized = normalizeExternalSourceUrl(raw);
    if (!normalized) continue;
    const url = new URL(normalized.canonicalUrl);
    const classified = classifySource(url, topic);
    const record: SourceRecord = {
      url: raw,
      canonicalUrl: normalized.canonicalUrl,
      host: normalized.host,
      label: sourceLabel(normalized.host, classified.tier),
      tier: classified.tier,
      rank: classified.rank,
      weak: classified.weak,
      trackingRemoved: normalized.trackingRemoved,
    };
    const previous = byCanonical.get(record.canonicalUrl);
    if (!previous || record.rank > previous.rank) byCanonical.set(record.canonicalUrl, record);
  }
  return [...byCanonical.values()].sort((a,b) => b.rank - a.rank || a.host.localeCompare(b.host) || a.canonicalUrl.localeCompare(b.canonicalUrl));
}

function claimStatus(status: string, sourceRequired: boolean): ClaimVerificationStatus {
  if (status === "CONTRADICTED") return "CONFLICTING_SOURCES";
  if (status === "UNSUPPORTED") return sourceRequired ? "NEEDS_SOURCE" : "UNVERIFIED";
  if (status === "TIME_SENSITIVE") return "PARTIALLY_VERIFIED";
  if (status === "VERIFIED") return "VERIFIED";
  return "UNVERIFIED";
}

function mapClaimSources(claim: string, sources: SourceRecord[]) {
  const tokens = topicTokens(claim);
  const strong = sources.filter((source) => !source.weak);
  const matched = strong.filter((source) => tokens.some((token) => source.host.includes(token)));
  return (matched.length ? matched : strong).slice(0, 4);
}

export function buildSourceIntelligence(input: {
  topic: string;
  sources: string[];
  checkedClaims?: Array<{ claim: string; sourceRequired: boolean; status: string }>;
  checkedAt?: string;
  uiLimit?: number;
}): SourceIntelligenceSummary {
  const auditSources = buildSourceRecords(input.topic, input.sources);
  const nonWeak = auditSources.filter((source) => !source.weak);
  const limit = Math.max(1, Math.min(input.uiLimit ?? 8, 8));

  const perHost = new Map<string, number>();
  const uiSources: SourceRecord[] = [];
  for (const source of nonWeak) {
    const used = perHost.get(source.host) ?? 0;
    if (used >= 3) continue;
    uiSources.push(source);
    perHost.set(source.host, used + 1);
    if (uiSources.length >= limit) break;
  }

  const checkedAt = input.checkedAt ?? new Date().toISOString();
  const claims = (input.checkedClaims ?? [])
    .filter((claim) => claim.sourceRequired || claim.status !== "NOT_FACTUAL")
    .map((claim) => {
      const mapped = mapClaimSources(claim.claim, auditSources);
      const status = claimStatus(claim.status, claim.sourceRequired);
      const sourceUrls = mapped.map((source) => source.canonicalUrl);
      return {
        claim: claim.claim,
        sourceUrls,
        sourceType: mapped[0]?.tier ?? "NONE",
        verificationStatus: status === "VERIFIED" && sourceUrls.length === 0 ? "NEEDS_SOURCE" : status,
        checkedAt,
      } satisfies ClaimSourceRecord;
    });

  return { auditSources, uiSources, claims };
}

export function hasCriticalUnsupportedClaim(summary: SourceIntelligenceSummary) {
  return summary.claims.some((claim) =>
    claim.verificationStatus === "NEEDS_SOURCE"
    || claim.verificationStatus === "UNVERIFIED"
    || claim.verificationStatus === "CONFLICTING_SOURCES"
  );
}
