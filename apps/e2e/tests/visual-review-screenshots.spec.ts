import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const routes = [
  ['home', '/'],
  ['features', '/funzionalita'],
  ['how-it-works', '/come-funziona'],
  ['pricing', '/prezzi'],
  ['faq', '/faq'],
  ['login', '/login'],
  ['register', '/register'],
  ['dashboard', '/app'],
  ['calendar', '/app/calendar'],
  ['approvals', '/app/approvals'],
  ['assets', '/app/assets'],
  ['brand', '/app/brand'],
  ['connections', '/app/connections'],
  ['analytics', '/app/analytics'],
] as const;

const output = path.resolve(process.cwd(), 'test-results/visual-review');

async function prepareVisualCapture(page: import('@playwright/test').Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => document.fonts.ready);
}

test('capture desktop visual review surfaces', async ({ page }) => {
  await mkdir(output, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await prepareVisualCapture(page);
  for (const [name, route] of routes) {
    await page.goto(route);
    await expect(page.locator('body')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(output, `${name}-desktop.png`), fullPage: true });
  }
});

test('capture mobile visual review surfaces', async ({ page }) => {
  await mkdir(output, { recursive: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await prepareVisualCapture(page);
  for (const [name, route] of [['home', '/'], ['dashboard', '/app'], ['calendar', '/app/calendar'], ['approvals', '/app/approvals'], ['assets', '/app/assets']] as const) {
    await page.goto(route);
    await expect(page.locator('body')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(output, `${name}-mobile.png`), fullPage: true });
  }
});