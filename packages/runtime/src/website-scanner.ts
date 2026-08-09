export interface PageFetchResult {
  status: number;
  contentType: string;
  body: string;
  finalUrl?: string;
}

export interface PageFetcher {
  fetch(url: string): Promise<PageFetchResult>;
}

export interface WebsiteScanPage {
  url: string;
  status: number;
  contentType: string;
  title: string;
  text: string;
  contentHash: string;
  discoveredLinks: string[];
}

export interface WebsiteScanResult {
  rootUrl: string;
  pages: WebsiteScanPage[];
  visitedCount: number;
  skippedExternalCount: number;
  skippedDuplicateCount: number;
  truncated: boolean;
}

const trackingParams = new Set(['gclid', 'fbclid', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']);

export const normalizeWebsiteUrl = (input: string, base?: string): string => {
  const url = base ? new URL(input, base) : new URL(input);
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (trackingParams.has(key.toLowerCase())) url.searchParams.delete(key);
  }
  url.hostname = url.hostname.toLowerCase();
  if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) url.port = '';
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString();
};

const extractTitle = (html: string): string => {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return cleanText(match?.[1] ?? '');
};

const cleanText = (html: string): string =>
  html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();

const extractLinks = (html: string, baseUrl: string): string[] => {
  const links = new Set<string>();
  const expression = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi;
  for (const match of html.matchAll(expression)) {
    const raw = match[1];
    if (!raw || raw.startsWith('mailto:') || raw.startsWith('tel:') || raw.startsWith('javascript:')) continue;
    try {
      links.add(normalizeWebsiteUrl(raw, baseUrl));
    } catch {
      // Invalid links are ignored; the scanner never follows malformed URLs.
    }
  }
  return [...links];
};

export const stableContentHash = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, '0')}`;
};

export class WebsiteScanner {
  constructor(private readonly fetcher: PageFetcher) {}

  async scan(input: { rootUrl: string; maxPages: number }): Promise<WebsiteScanResult> {
    if (!Number.isInteger(input.maxPages) || input.maxPages < 1 || input.maxPages > 500) {
      throw new Error('scanner_invalid_page_limit');
    }

    const rootUrl = normalizeWebsiteUrl(input.rootUrl);
    const root = new URL(rootUrl);
    if (root.protocol !== 'http:' && root.protocol !== 'https:') throw new Error('scanner_unsupported_protocol');

    const queue: string[] = [rootUrl];
    const queued = new Set(queue);
    const visited = new Set<string>();
    const pages: WebsiteScanPage[] = [];
    let skippedExternalCount = 0;
    let skippedDuplicateCount = 0;

    while (queue.length > 0 && pages.length < input.maxPages) {
      const next = queue.shift();
      if (!next) break;
      queued.delete(next);
      if (visited.has(next)) {
        skippedDuplicateCount += 1;
        continue;
      }
      visited.add(next);

      const response = await this.fetcher.fetch(next);
      const finalUrl = normalizeWebsiteUrl(response.finalUrl ?? next, next);
      const final = new URL(finalUrl);
      if (final.origin !== root.origin) {
        skippedExternalCount += 1;
        continue;
      }

      const isHtml = response.contentType.toLowerCase().includes('text/html');
      const links = isHtml ? extractLinks(response.body, finalUrl) : [];
      const text = isHtml ? cleanText(response.body) : '';
      pages.push({
        url: finalUrl,
        status: response.status,
        contentType: response.contentType,
        title: isHtml ? extractTitle(response.body) : '',
        text,
        contentHash: stableContentHash(`${response.status}\n${response.contentType}\n${text}`),
        discoveredLinks: links,
      });

      for (const link of links) {
        const candidate = new URL(link);
        if (candidate.origin !== root.origin) {
          skippedExternalCount += 1;
          continue;
        }
        if (visited.has(link) || queued.has(link)) {
          skippedDuplicateCount += 1;
          continue;
        }
        queue.push(link);
        queued.add(link);
      }
    }

    return {
      rootUrl,
      pages,
      visitedCount: visited.size,
      skippedExternalCount,
      skippedDuplicateCount,
      truncated: queue.length > 0,
    };
  }
}

export class FixturePageFetcher implements PageFetcher {
  constructor(private readonly fixtures: Record<string, PageFetchResult>) {}

  async fetch(url: string): Promise<PageFetchResult> {
    const fixture = this.fixtures[normalizeWebsiteUrl(url)];
    if (!fixture) throw new Error(`fixture_not_found:${url}`);
    return { ...fixture };
  }
}
