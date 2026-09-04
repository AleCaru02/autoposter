import type { VercelRequest, VercelResponse } from "@vercel/node";
import { analyzeBrandFromWebsite, type WebsiteVisualHints } from "./_lib/brand-analysis.js";
import { BrandAnalysisMetering } from "./_lib/brand-analysis-metering.js";

export const config = { maxDuration: 60 };

const DATA_API = "https://ep-nameless-truth-a698bwer.apirest.us-west-2.aws.neon.tech/neondb/rest/v1";

type ProfileRow = { id: string; name: string; website_url: string | null; industry: string | null };
type ScanRow = { id: string };
type PageRow = { url: string; title: string | null; content_text: string | null };
type ExistingBrand = { profile_id: string; social_links: unknown };

function bearer(req: VercelRequest) {
  const value = req.headers.authorization;
  return value?.startsWith("Bearer ") ? value.slice(7).trim() || null : null;
}

async function dataApi(path: string, token: string, init: RequestInit = {}) {
  return fetch(`${DATA_API}/${path}`, { ...init, headers: { authorization: `Bearer ${token}`, accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) } });
}

async function rows<T>(path: string, token: string): Promise<T[]> {
  const response = await dataApi(path, token);
  if (!response.ok) throw new Error(`DATA_API_${response.status}`);
  return response.json() as Promise<T[]>;
}

function stringList(value: unknown, max: number) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()).slice(0, max) : [];
}

function safeUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch { return null; }
}

function sanitizeVisualHints(value: unknown): WebsiteVisualHints {
  if (!value || typeof value !== "object") return { colors: [], fontFamilies: [], socialLinks: {}, logoUrl: null, logoCandidates: [], imageUrls: [], stylesheetUrls: [], pageSignals: [] };
  const input = value as Record<string, unknown>;
  const socialLinks = input.socialLinks && typeof input.socialLinks === "object"
    ? Object.fromEntries(Object.entries(input.socialLinks as Record<string, unknown>).map(([key, item]) => [key, safeUrl(item)]).filter((entry): entry is [string, string] => Boolean(entry[1])))
    : {};
  const pageSignals = Array.isArray(input.pageSignals) ? input.pageSignals.slice(0, 80).flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>;
    const url = safeUrl(item.url);
    if (!url) return [];
    return [{
      url,
      canonicalUrl: safeUrl(item.canonicalUrl),
      headings: stringList(item.headings, 20),
      imageUrls: stringList(item.imageUrls, 8).map(safeUrl).filter((entry): entry is string => Boolean(entry)),
      ogImageUrl: safeUrl(item.ogImageUrl),
      schemaTypes: stringList(item.schemaTypes, 16),
    }];
  }) : [];
  return {
    colors: stringList(input.colors, 12),
    fontFamilies: stringList(input.fontFamilies, 10),
    socialLinks,
    logoUrl: safeUrl(input.logoUrl),
    logoCandidates: stringList(input.logoCandidates, 8).map(safeUrl).filter((entry): entry is string => Boolean(entry)),
    imageUrls: stringList(input.imageUrls, 40).map(safeUrl).filter((entry): entry is string => Boolean(entry)),
    stylesheetUrls: stringList(input.stylesheetUrls, 16).map(safeUrl).filter((entry): entry is string => Boolean(entry)),
    pageSignals,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  const token = bearer(req);
  if (!token) return res.status(401).json({ error: "AUTH_REQUIRED" });
  if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: "OPENAI_NOT_CONFIGURED" });
  if (!process.env.DATABASE_URL) return res.status(503).json({ error: "DATABASE_NOT_CONFIGURED" });
  const profileId = typeof req.body?.profileId === "string" ? req.body.profileId : "";
  if (!profileId) return res.status(400).json({ error: "PROFILE_REQUIRED" });
  const visualHints = sanitizeVisualHints(req.body?.visualHints);

  let activeMeter: BrandAnalysisMetering | null = null;
  let activeEventId: string | null = null;
  let logicalCommitted = false;
  try {
    const profile = (await rows<ProfileRow>(`profiles?id=eq.${encodeURIComponent(profileId)}&select=id,name,website_url,industry&limit=1`, token))[0];
    if (!profile) return res.status(404).json({ error: "PROFILE_NOT_FOUND" });
    const scan = (await rows<ScanRow>(`website_scans?profile_id=eq.${encodeURIComponent(profileId)}&state=in.(COMPLETE,PARTIAL)&select=id&order=created_at.desc&limit=1`, token))[0];
    if (!scan) return res.status(409).json({ error: "WEBSITE_SCAN_REQUIRED" });
    const pageRows = await rows<PageRow>(`website_pages?scan_id=eq.${encodeURIComponent(scan.id)}&profile_id=eq.${encodeURIComponent(profileId)}&status=eq.ANALYZED&select=url,title,content_text&order=depth.asc&limit=100`, token);
    const pages = pageRows.filter((page) => Boolean(page.content_text)).map((page) => ({ url: page.url, title: page.title, text: page.content_text ?? "" }));
    if (!pages.length) return res.status(409).json({ error: "NO_ANALYZED_WEBSITE_PAGES" });

    const meter = new BrandAnalysisMetering(process.env.DATABASE_URL);
    activeMeter = meter;
    const reservation = await meter.reserve({ profileId, scanId: scan.id });
    if (reservation.status === "DENIED") return res.status(429).json({ error: reservation.code });
    if (reservation.status === "COMPLETED") return res.status(200).json(reservation.cached.response);
    if (reservation.status === "IN_PROGRESS") return res.status(409).json({ error: "BRAND_ANALYSIS_IN_PROGRESS" });
    if (reservation.status === "RELEASED") return res.status(409).json({ error: "METERING_FAILED" });
    const eventId = reservation.eventId;
    activeEventId = eventId;

    await meter.markProviderStarted(eventId);
    const result = await analyzeBrandFromWebsite({ apiKey: process.env.OPENAI_API_KEY, profileName: profile.name, websiteUrl: profile.website_url, industry: profile.industry, pages, visualHints });
    await meter.persistTechnicalUsage(profileId, eventId, result, { scan_id: scan.id, pages_analyzed: pages.length });
    const existingRows = await rows<ExistingBrand>(`brand_profiles?profile_id=eq.${encodeURIComponent(profileId)}&select=profile_id,social_links&limit=1`, token);
    const existingSocials = existingRows[0]?.social_links && typeof existingRows[0].social_links === "object" ? existingRows[0].social_links as Record<string, unknown> : {};
    const socialLinks = { ...visualHints.socialLinks, ...Object.fromEntries(Object.entries(existingSocials).filter(([, item]) => typeof item === "string" && item)) };
    const now = new Date().toISOString();
    const visualIdentity = {
      source: "website_scan",
      observedColors: visualHints.colors,
      observedFonts: visualHints.fontFamilies,
      logoUrl: visualHints.logoUrl,
      logoCandidates: visualHints.logoCandidates,
      observedImages: visualHints.imageUrls,
      stylesheets: visualHints.stylesheetUrls,
      pageSignals: visualHints.pageSignals,
      pageInsights: result.analysis.pageInsights,
      contentPillars: result.analysis.contentPillars,
      summary: result.analysis.visualStyleSummary,
      analyzedAt: now,
    };
    const payload = {
      profile_id: profileId,
      description: result.analysis.description,
      business_model: result.analysis.businessModel,
      location: result.analysis.location,
      service_area: result.analysis.serviceArea,
      target_audience: result.analysis.targetAudience,
      services: result.analysis.services,
      differentiators: result.analysis.differentiators,
      value_propositions: result.analysis.valuePropositions,
      visual_identity: visualIdentity,
      tone_of_voice: result.analysis.toneOfVoice,
      social_links: socialLinks,
      goals: result.analysis.goals,
      updated_at: now,
    };

    const write = existingRows[0]
      ? await dataApi(`brand_profiles?profile_id=eq.${encodeURIComponent(profileId)}`, token, { method: "PATCH", headers: { prefer: "return=minimal" }, body: JSON.stringify(payload) })
      : await dataApi("brand_profiles", token, { method: "POST", headers: { prefer: "return=minimal" }, body: JSON.stringify(payload) });
    if (!write.ok) throw new Error(`BRAND_PROFILE_WRITE_${write.status}`);

    const profilePatch: Record<string, unknown> = { onboarding_completed: true, updated_at: now };
    if (!profile.industry && result.analysis.industry) profilePatch.industry = result.analysis.industry;
    const profileWrite = await dataApi(`profiles?id=eq.${encodeURIComponent(profileId)}`, token, { method: "PATCH", headers: { prefer: "return=minimal" }, body: JSON.stringify(profilePatch) });
    if (!profileWrite.ok) throw new Error(`PROFILE_ONBOARDING_WRITE_${profileWrite.status}`);

    const responseBody = { analysis: result.analysis, visualHints, pagesAnalyzed: pages.length, model: result.model };
    await meter.storeResult(eventId, { response: responseBody });
    await meter.commit(eventId);
    logicalCommitted = true;
    return res.status(200).json(responseBody);
  } catch (reason) {
    if (activeMeter && activeEventId && !logicalCommitted) await activeMeter.release(activeEventId, reason instanceof Error ? reason.message : "BRAND_ANALYSIS_FAILED").catch(() => undefined);
    const detail = reason instanceof Error ? reason.message : "UNKNOWN_ONBOARDING_ANALYSIS_ERROR";
    console.error("onboarding-analyze", { profileId, detail });
    const status = detail.startsWith("OPENAI_") ? 502 : detail.startsWith("METERING_FAILED") ? 503 : 500;
    return res.status(status).json({ error: detail.startsWith("METERING_FAILED") ? "METERING_FAILED" : "ONBOARDING_ANALYSIS_FAILED" });
  }
}
