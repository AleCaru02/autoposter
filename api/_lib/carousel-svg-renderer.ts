/** Deterministic, tenant-scoped carousel artwork. No AI or infrastructure calls. */
export type CarouselSlide = { headline: string; body?: string; kicker?: string };
export type CarouselBrand = { name: string; primaryColor: string; backgroundColor: string; textColor: string; cta?: string };
const esc = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const color = (value: string, fallback: string) => /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
function lines(value: string, maxChars: number, maxLines: number): string[] {
  const words = value.replace(/[\u0000-\u001f]/g, " ").trim().split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let line = "";
  for (const word of words) {
    if (word.length > maxChars) throw new Error("CAROUSEL_WORD_TOO_LONG");
    if (line && (line + " " + word).length > maxChars) { out.push(line); line = word; }
    else line = line ? line + " " + word : word;
  }
  if (line) out.push(line);
  if (out.length > maxLines) throw new Error("CAROUSEL_TEXT_TOO_LONG");
  return out;
}
function block(rows: string[], x: number, y: number, lineHeight: number) {
  return rows.map((row, i) => `<tspan x="${x}" y="${y + i * lineHeight}">${esc(row)}</tspan>`).join("");
}
/** Generates Instagram portrait 1080x1350 SVG slides, ready for server-side PNG conversion. */
export function renderCarouselSvg(slide: CarouselSlide, brand: CarouselBrand, index: number, total: number): string {
  if (!Number.isInteger(index) || !Number.isInteger(total) || total < 2 || total > 10 || index < 0 || index >= total) throw new Error("CAROUSEL_INVALID_INDEX");
  if (!slide.headline.trim() || !brand.name.trim()) throw new Error("CAROUSEL_MISSING_CONTENT");
  const primary = color(brand.primaryColor, "#2E6B57");
  const bg = color(brand.backgroundColor, "#101A17");
  const ink = color(brand.textColor, "#FFFFFF");
  const title = lines(slide.headline, 23, 5);
  const body = lines(slide.body ?? "", 43, 4);
  const kicker = lines(slide.kicker ?? (index === 0 ? "DA SAPERE" : "IN PRATICA"), 35, 1);
  const cta = lines(brand.cta ?? "Scopri di più", 35, 1);
  const name = lines(brand.name, 32, 1);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350">
<rect width="1080" height="1350" fill="${bg}"/>
<rect x="0" y="0" width="1080" height="18" fill="${primary}"/>
<circle cx="1040" cy="100" r="270" fill="${primary}" opacity=".13"/>
<text x="84" y="115" fill="${ink}" font-family="Arial,sans-serif" font-size="33" font-weight="700">${block(name,84,115,42)}</text>
<rect x="84" y="206" width="140" height="7" rx="3" fill="${primary}"/>
<text x="84" y="280" fill="${primary}" font-family="Arial,sans-serif" font-size="29" font-weight="700" letter-spacing="3">${block(kicker,84,280,38)}</text>
<text fill="${ink}" font-family="Arial,sans-serif" font-size="76" font-weight="800">${block(title,84,390,99)}</text>
<text fill="${ink}" opacity=".86" font-family="Arial,sans-serif" font-size="38">${block(body,84,950,58)}</text>
<rect x="84" y="1210" width="912" height="2" fill="${ink}" opacity=".24"/>
<text x="84" y="1275" fill="${ink}" font-family="Arial,sans-serif" font-size="29">${block(cta,84,1275,35)}</text>
<text x="996" y="1275" text-anchor="end" fill="${ink}" font-family="Arial,sans-serif" font-size="29">${index+1} / ${total}</text>
</svg>`;
}
export function renderCarouselBundle(slides: CarouselSlide[], brand: CarouselBrand): string[] {
  if (slides.length < 2 || slides.length > 10) throw new Error("CAROUSEL_INVALID_SLIDE_COUNT");
  return slides.map((slide, index) => renderCarouselSvg(slide, brand, index, slides.length));
}
