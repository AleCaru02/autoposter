export const CLOUDFLARE_FREE_SUBREQUEST_LIMIT = 50;
export const SAFE_SCAN_MAX_PAGES = 8;
export const SAFE_SCAN_MAX_SITEMAPS = 3;
export const SAFE_SCAN_MAX_STYLESHEETS = 2;

export function boundedScanPageLimit(value: unknown) {
  const requested = Number(value ?? SAFE_SCAN_MAX_PAGES);
  if (!Number.isFinite(requested)) return SAFE_SCAN_MAX_PAGES;
  return Math.min(Math.max(Math.trunc(requested), 1), SAFE_SCAN_MAX_PAGES);
}

// Conservative upper bound for the Worker path. DNS is memoized per hostname;
// stylesheet hosts are still charged as two DNS calls plus the stylesheet fetch.
export function estimatedScanSubrequests(pageLimit = SAFE_SCAN_MAX_PAGES) {
  const pages = boundedScanPageLimit(pageLimit);
  const profileRead = 1;
  const rootDns = 2;
  const scanCreate = 1;
  const robots = 1;
  const sitemaps = SAFE_SCAN_MAX_SITEMAPS;
  const htmlPages = pages;
  const externalStylesheetsWorstCase = SAFE_SCAN_MAX_STYLESHEETS * 3;
  const pageWrites = Math.ceil(pages / 25);
  const scanFinish = 1;
  return profileRead + rootDns + scanCreate + robots + sitemaps + htmlPages + externalStylesheetsWorstCase + pageWrites + scanFinish;
}
