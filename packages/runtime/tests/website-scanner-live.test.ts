import { describe, expect, it } from 'vitest';
import { HttpPageFetcher, WebsiteScanner } from '../src/website-scanner.js';

const live = process.env.RUN_LIVE_WEBSITE_SMOKE === 'true' ? it : it.skip;

describe('WebsiteScanner public HTTP smoke', () => {
  live('fetches and parses a real public website without AI or credentials', async () => {
    const scanner = new WebsiteScanner(new HttpPageFetcher({ timeoutMs: 10_000, maxBytes: 1_000_000, maxRedirects: 5 }));
    const result = await scanner.scan({ rootUrl: 'https://example.com/', maxPages: 1 });

    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]?.status).toBe(200);
    expect(result.pages[0]?.url).toBe('https://example.com/');
    expect(result.pages[0]?.title.toLowerCase()).toContain('example');
    expect(result.pages[0]?.text.toLowerCase()).toContain('example domain');
    expect(result.visitedCount).toBe(1);
    expect(result.errors.filter((error) => error.url === 'https://example.com/')).toEqual([]);
  }, 20_000);
});
