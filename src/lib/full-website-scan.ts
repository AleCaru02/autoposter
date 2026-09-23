export type WebsiteVisualHints = {
  colors?: string[];
  fontFamilies?: string[];
  socialLinks?: Record<string, string>;
  logoUrl?: string | null;
  logoCandidates?: string[];
  imageUrls?: string[];
  stylesheetUrls?: string[];
  pageSignals?: Array<Record<string, unknown> & { url?: string }>;
};

export type WebsiteScanBatch = {
  scanId?: string;
  state?: string;
  discoveredPages?: number;
  analyzedPages?: number;
  skippedPages?: number;
  failedPages?: number;
  pendingPages?: number;
  completeCoverage?: boolean;
  hasMore?: boolean;
  stopReason?: string;
  reused?: boolean;
  visualHints?: WebsiteVisualHints;
  error?: string;
  message?: string;
};

export type FullWebsiteScanResult = WebsiteScanBatch & {
  visualHints: WebsiteVisualHints;
  batches: number;
};

function mergeUnique(left: string[] = [], right: string[] = [], limit = 500) {
  return [...new Set([...left, ...right])].slice(0, limit);
}

export function mergeWebsiteVisualHints(current: WebsiteVisualHints, next: WebsiteVisualHints | undefined): WebsiteVisualHints {
  if (!next) return current;
  const socialLinks = { ...(current.socialLinks ?? {}), ...(next.socialLinks ?? {}) };
  const signalMap = new Map<string, Record<string, unknown> & { url?: string }>();
  for (const signal of [...(current.pageSignals ?? []), ...(next.pageSignals ?? [])]) {
    const key = typeof signal.url === "string" && signal.url ? signal.url : JSON.stringify(signal);
    signalMap.set(key, signal);
  }
  return {
    colors: mergeUnique(current.colors, next.colors, 24),
    fontFamilies: mergeUnique(current.fontFamilies, next.fontFamilies, 20),
    socialLinks,
    logoUrl: current.logoUrl || next.logoUrl || null,
    logoCandidates: mergeUnique(current.logoCandidates, next.logoCandidates, 16),
    imageUrls: mergeUnique(current.imageUrls, next.imageUrls, 80),
    stylesheetUrls: mergeUnique(current.stylesheetUrls, next.stylesheetUrls, 24),
    pageSignals: [...signalMap.values()].slice(0, 160),
  };
}

export async function runFullWebsiteScan(input: {
  profileId: string;
  token: string;
  forceNew?: boolean;
  onProgress?: (batch: WebsiteScanBatch) => void;
}): Promise<FullWebsiteScanResult> {
  let hints: WebsiteVisualHints = {};
  let latest: WebsiteScanBatch = {};
  const maxBatches = 260;

  for (let batchIndex = 0; batchIndex < maxBatches; batchIndex += 1) {
    const response = await fetch("/api/website-scan", {
      method: "POST",
      headers: { authorization: `Bearer ${input.token}`, "content-type": "application/json" },
      body: JSON.stringify({
        profileId: input.profileId,
        pageLimit: 8,
        forceNew: Boolean(input.forceNew && batchIndex === 0),
      }),
    });
    const body = await response.json().catch(() => ({})) as WebsiteScanBatch;
    if (!response.ok) {
      const error = new Error(body.message || body.error || "Scansione non riuscita.");
      (error as Error & { code?: string }).code = body.error;
      throw error;
    }
    latest = body;
    hints = mergeWebsiteVisualHints(hints, body.visualHints);
    input.onProgress?.(body);
    if (!body.hasMore) return { ...latest, visualHints: hints, batches: batchIndex + 1 };
  }

  throw new Error("La scansione ha raggiunto il limite di sicurezza di 2.000 pagine. Controlla la sezione Sito.");
}
