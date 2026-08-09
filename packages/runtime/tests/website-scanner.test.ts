import { describe, expect, it } from 'vitest';
import {
  FixturePageFetcher,
  WebsiteScanner,
  normalizeWebsiteUrl,
  stableContentHash,
} from '../src/website-scanner.js';

describe('WebsiteScanner', () => {
  it('normalizes tracking parameters and hashes content deterministically', () => {
    expect(normalizeWebsiteUrl('https://Example.test/path/?utm_source=ads&x=1#hero')).toBe(
      'https://example.test/path?x=1',
    );
    expect(stableContentHash('same')).toBe(stableContentHash('same'));
    expect(stableContentHash('same')).not.toBe(stableContentHash('different'));
  });

  it('crawls same-origin pages, ignores external links and respects page limits', async () => {
    const fetcher = new FixturePageFetcher({
      'https://example.test/': {
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: `
          <html><head><title>Home Demo</title><style>.x{color:red}</style></head>
          <body>
            <h1>Servizi professionali</h1>
            <a href="/about?utm_campaign=test">Chi siamo</a>
            <a href="/about#team">Team</a>
            <a href="/contact">Contatti</a>
            <a href="https://outside.example.org/page">Esterno</a>
          </body></html>`,
      },
      'https://example.test/about': {
        status: 200,
        contentType: 'text/html',
        body: '<html><head><title>Chi siamo</title></head><body>La nostra storia <a href="/">Home</a></body></html>',
      },
      'https://example.test/contact': {
        status: 200,
        contentType: 'text/html',
        body: '<html><head><title>Contatti</title></head><body>Scrivici</body></html>',
      },
    });

    const result = await new WebsiteScanner(fetcher).scan({ rootUrl: 'https://example.test/', maxPages: 2 });
    expect(result.pages).toHaveLength(2);
    expect(result.pages.map((page) => page.url)).toEqual(['https://example.test/', 'https://example.test/about']);
    expect(result.pages[0]?.title).toBe('Home Demo');
    expect(result.pages[0]?.text).toContain('Servizi professionali');
    expect(result.pages[0]?.text).not.toContain('color:red');
    expect(result.skippedExternalCount).toBeGreaterThanOrEqual(1);
    expect(result.skippedDuplicateCount).toBeGreaterThanOrEqual(1);
    expect(result.truncated).toBe(true);
  });

  it('rejects unsafe/unbounded page limits', async () => {
    const scanner = new WebsiteScanner(new FixturePageFetcher({}));
    await expect(scanner.scan({ rootUrl: 'https://example.test', maxPages: 0 })).rejects.toThrow(
      'scanner_invalid_page_limit',
    );
    await expect(scanner.scan({ rootUrl: 'https://example.test', maxPages: 501 })).rejects.toThrow(
      'scanner_invalid_page_limit',
    );
  });
});
