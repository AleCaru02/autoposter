import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const base = (process.env.VITE_PUBLIC_SITE_URL || process.env.PUBLIC_SITE_URL || 'http://localhost:5173').replace(/\/$/, '');
const routes = [
  '/',
  '/come-funziona',
  '/funzionalita',
  '/prezzi',
  '/faq',
  '/social-media-manager-ai',
  '/gestione-social-automatica',
];
const publicDir = resolve(process.cwd(), 'public');
await mkdir(publicDir, { recursive: true });

const urls = routes.map((path) => `  <url><loc>${base}${path === '/' ? '' : path}</loc></url>`).join('\n');
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
const robots = `User-agent: *\nAllow: /\nDisallow: /app\nDisallow: /admin\nDisallow: /onboarding\nDisallow: /approvals\nDisallow: /login\nDisallow: /register\nDisallow: /reset-password\nSitemap: ${base}/sitemap.xml\n`;

await Promise.all([
  writeFile(resolve(publicDir, 'sitemap.xml'), sitemap, 'utf8'),
  writeFile(resolve(publicDir, 'robots.txt'), robots, 'utf8'),
]);

console.log(`SEO files generated for ${base}`);
