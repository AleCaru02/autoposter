import { expect, test, type Page, type TestInfo } from '@playwright/test';

const watchBrowserErrors = (page: Page) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror:${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console:${message.text()}`);
  });
  return errors;
};

const expectNoHorizontalOverflow = async (page: Page) => {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scroll, `horizontal overflow: ${JSON.stringify(dimensions)}`).toBeLessThanOrEqual(dimensions.viewport + 1);
};

const screenshot = async (page: Page, testInfo: TestInfo, name: string) => {
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true });
};

test.describe('public redesign + SEO quality gate', () => {
  test('desktop landing communicates the product and has clean browser output', async ({ page }, testInfo) => {
    const errors = watchBrowserErrors(page);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Il tuo Social Media Manager AI/);
    await expect(page.getByRole('link', { name: /Inizia a configurare il brand/ })).toBeVisible();
    await expect(page.getByText('Website analysis', { exact: true })).toBeVisible();
    await expect(page.getByText('Non è cross-posting', { exact: true })).toBeVisible();
    await expect(page.getByText('Competitor intelligence', { exact: true })).toBeVisible();
    await expect(page.locator('main h1')).toHaveCount(1);
    await expectNoHorizontalOverflow(page);
    await screenshot(page, testInfo, 'landing-desktop');
    expect(errors).toEqual([]);
  });

  test('public metadata, structured data and crawl controls are coherent', async ({ page, request }) => {
    const errors = watchBrowserErrors(page);
    await page.goto('/');

    await expect(page).toHaveTitle(/SocialPilot AI/);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /Analizza il brand/i);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /127\.0\.0\.1:5173\/?$/);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /index,follow/);
    await expect(page.locator('script[data-socialpilot-schema]')).toHaveCount(2);
    const schemaTypes = await page.locator('script[data-socialpilot-schema]').evaluateAll((nodes) => nodes.map((node) => JSON.parse(node.textContent || '{}')['@type']));
    expect(schemaTypes).toEqual(expect.arrayContaining(['Organization', 'SoftwareApplication']));

    const sitemap = await request.get('/sitemap.xml');
    expect(sitemap.ok()).toBeTruthy();
    const sitemapText = await sitemap.text();
    expect(sitemapText).toContain('/come-funziona');
    expect(sitemapText).toContain('/social-media-manager-ai');
    expect(sitemapText).not.toContain('/app');
    expect(sitemapText).not.toContain('/admin');

    const robots = await request.get('/robots.txt');
    expect(robots.ok()).toBeTruthy();
    const robotsText = await robots.text();
    expect(robotsText).toContain('Disallow: /app');
    expect(robotsText).toContain('Disallow: /admin');
    expect(robotsText).toContain('Disallow: /login');

    await page.goto('/login');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex,nofollow');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/login$/);
    expect(errors).toEqual([]);
  });

  test('marketing information architecture renders substantive unique pages', async ({ page }) => {
    const errors = watchBrowserErrors(page);
    const pages = [
      ['/come-funziona', 'Un workflow leggibile'],
      ['/funzionalita', 'Una control room per il lavoro social'],
      ['/prezzi', 'Scegli il livello di automazione'],
      ['/faq', 'Domande prima di affidare il workflow'],
      ['/social-media-manager-ai', 'Un Social Media Manager AI serve solo se gestisce il processo'],
      ['/gestione-social-automatica', 'Automazione non significa perdere il controllo'],
    ] as const;

    const titles = new Set<string>();
    for (const [path, heading] of pages) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toContainText(heading);
      const title = await page.title();
      expect(title.length).toBeGreaterThan(15);
      expect(titles.has(title), `duplicate title: ${title}`).toBeFalsy();
      titles.add(title);
      await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /.+/);
      await expectNoHorizontalOverflow(page);
    }
    expect(errors).toEqual([]);
  });

  test('responsive landing is intentionally usable at 320, 375, 390, 430 and tablet widths', async ({ page }, testInfo) => {
    const errors = watchBrowserErrors(page);
    const widths = [320, 375, 390, 430, 768];
    for (const width of widths) {
      await page.setViewportSize({ width, height: width === 768 ? 1024 : 844 });
      await page.goto('/');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.getByRole('link', { name: /Inizia a configurare il brand/ })).toBeVisible();
      await expect(page.locator('.public-nav')).toBeVisible();
      await expectNoHorizontalOverflow(page);
      if (width === 390 || width === 768) await screenshot(page, testInfo, `landing-${width}`);
    }
    expect(errors).toEqual([]);
  });

  test('public presales chatbot is a keyboard-reachable disclosure with labeled controls', async ({ page }) => {
    const errors = watchBrowserErrors(page);
    await page.goto('/');
    const launcher = page.locator('.sales-chat-launcher');
    await launcher.focus();
    await expect(launcher).toBeFocused();
    await launcher.press('Enter');
    await expect(launcher).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByLabel('Domanda al chatbot')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Chiedi', exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });
});
