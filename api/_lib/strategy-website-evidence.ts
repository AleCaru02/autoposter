/**
 * Ground strategy and planning in the *actual, previously scanned* pages of
 * this activity, not merely the homepage or an AI-invented site summary.
 * Scanning is a separate operation: this module never claims that a stored
 * page was fetched live.
 */
export type ScannedWebsitePage = {
  url: string; title: string | null; meta_description: string | null;
  content_excerpt: string | null; scanned_at: string | null;
};
export type WebsitePlanningEvidence = {
  scannedPageCount: number;
  latestScanAt: string | null;
  sampledPageCount: number;
  sections: Array<{ section: string; pageCount: number }>;
  pages: Array<{ url: string; title: string; description: string; excerpt: string }>;
};

function clean(text: string | null | undefined, max: number) {
  return (text ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}
function pageSection(rawUrl: string) {
  try {
    const parts = new URL(rawUrl).pathname.split("/").filter(Boolean);
    return parts.length ? parts[0].toLowerCase() : "homepage";
  } catch {
    return "unknown";
  }
}
function priority(page: ScannedWebsitePage) {
  const text = `${pageSection(page.url)} ${page.url} ${page.title || ""}`.toLowerCase();
  if (/homepage|chi-siamo|about|servizi|services|contatti|contact|prezzi|pricing|faq|domande|mission|offert|solutions|soluzioni/.test(text)) return 50;
  if (/blog|articol|guide|risors|casi-studio|case-study|academy|news/.test(text)) return 20;
  return 10;
}
export function buildWebsitePlanningEvidence(input: ScannedWebsitePage[], maxPages = 36): WebsitePlanningEvidence {
  const seen = new Set<string>();
  const valid = input.filter((page) => {
    try {
      const url = new URL(page.url);
      if (url.protocol !== "https:" && url.protocol !== "http:") return false;
      const canonical = `${url.origin}${url.pathname.replace(/\/$/, "")}`.toLowerCase();
      if (seen.has(canonical)) return false;
      seen.add(canonical);
      return true;
    } catch { return false; }
  });
  const counts = new Map<string, number>();
  for (const page of valid) { const section = pageSection(page.url); counts.set(section, (counts.get(section) ?? 0) + 1); }
  const sections = [...counts].map(([section,pageCount]) => ({section,pageCount})).sort((a,b)=>b.pageCount-a.pageCount).slice(0,25);
  // One page per distinct section first, then fill remaining slots by
  // business relevance; 800 SEO posts must not drown out core service pages.
  const ranked = [...valid].sort((a,b)=>priority(b)-priority(a) || a.url.localeCompare(b.url));
  const chosen: ScannedWebsitePage[] = [];
  const usedSections = new Set<string>();
  for (const page of ranked) {
    const section=pageSection(page.url);
    if (usedSections.has(section)) continue;
    chosen.push(page); usedSections.add(section);
    if (chosen.length>=maxPages) break;
  }
  for (const page of ranked) {
    if(chosen.length>=maxPages) break;
    if(!chosen.includes(page)) chosen.push(page);
  }
  const dates = valid.map(page=>page.scanned_at).filter((date):date is string=>typeof date==="string"&&Number.isFinite(Date.parse(date))).sort();
  return {
    scannedPageCount: valid.length,
    latestScanAt: dates.length ? dates[dates.length-1] : null,
    sampledPageCount: chosen.length,
    sections,
    pages: chosen.map(page=>({url:page.url,title:clean(page.title,140),description:clean(page.meta_description,220),excerpt:clean(page.content_excerpt,320)})),
  };
}
