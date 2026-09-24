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

export type WebsiteScanProgress = {
  processed: number;
  total: number;
  percent: number;
};

export function websiteScanProgress(batch: WebsiteScanBatch): WebsiteScanProgress {
  const analyzed = Math.max(0, batch.analyzedPages ?? 0);
  const skipped = Math.max(0, batch.skippedPages ?? 0);
  const failed = Math.max(0, batch.failedPages ?? 0);
  const pending = Math.max(0, batch.pendingPages ?? 0);
  const processed = analyzed + skipped + failed;
  const total = Math.max(batch.discoveredPages ?? 0, processed + pending, processed);
  if (batch.hasMore === false && total > 0) return { processed, total, percent: 100 };
  if (total <= 0) return { processed, total: 0, percent: 0 };
  return { processed, total, percent: Math.min(99, Math.max(1, Math.floor((processed / total) * 100))) };
}

const TRANSIENT_SCAN_STATUS = new Set([401, 408, 425, 429, 500, 502, 503, 504]);

function wait(ms: number, signal?: AbortSignal) {
  if (signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}

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
  token?: string;
  getToken?: () => Promise<string>;
  forceNew?: boolean;
  onProgress?: (batch: WebsiteScanBatch) => void;
  signal?: AbortSignal;
}): Promise<FullWebsiteScanResult> {
  let hints: WebsiteVisualHints = {};
  let latest: WebsiteScanBatch = {};
  const maxBatches = 260;

  for (let batchIndex = 0; batchIndex < maxBatches; batchIndex += 1) {
    if (input.signal?.aborted) throw new DOMException("Aborted", "AbortError");

    let body: WebsiteScanBatch = {};
    let completed = false;
    let previousStatus: number | null = null;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (input.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const token = input.getToken ? await input.getToken() : input.token;
      if (!token) throw new Error("Sessione non disponibile. Riprova.");

      let response: Response;
      try {
        response = await fetch("/api/website-scan", {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          signal: input.signal,
          body: JSON.stringify({
            profileId: input.profileId,
            pageLimit: 4,
            forceNew: Boolean(input.forceNew && batchIndex === 0 && (attempt === 0 || previousStatus === 401)),
          }),
        });
      } catch (reason) {
        if (attempt >= 2 || input.signal?.aborted) throw reason;
        previousStatus = null;
        await wait(attempt === 0 ? 250 : 700, input.signal);
        continue;
      }

      previousStatus = response.status;
      body = await response.json().catch(() => ({})) as WebsiteScanBatch;
      if (response.ok) {
        completed = true;
        break;
      }

      const retryable = TRANSIENT_SCAN_STATUS.has(response.status)
        || body.error === "AUTH_REQUIRED"
        || body.error === "SCAN_FAILED";
      if (!retryable || attempt >= 2) {
        const error = new Error(body.message || body.error || "Scansione non riuscita.");
        (error as Error & { code?: string }).code = body.error;
        throw error;
      }
      await wait(attempt === 0 ? 250 : 700, input.signal);
    }

    if (!completed) throw new Error("Scansione non riuscita.");
    latest = body;
    hints = mergeWebsiteVisualHints(hints, body.visualHints);
    input.onProgress?.(body);
    if (!body.hasMore) return { ...latest, visualHints: hints, batches: batchIndex + 1 };
  }

  throw new Error("La scansione ha raggiunto il limite di sicurezza di 2.000 pagine. Controlla la sezione Sito.");
}
