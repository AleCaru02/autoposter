import type { VercelRequest, VercelResponse } from "@vercel/node";
import { analyzeBrandFromWebsite, type WebsiteVisualHints } from "./_lib/brand-analysis.js";

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
  return fetch(`${DATA_API}/${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
}

async function rows<T>(path: string, token: string): Promise<T[]> {
  const response = await dataApi(path, token);
  if (!response.ok) throw new Error(`DATA_API_${response.status}`);
  return response.json() as Promise<T[]>;
}

function sanitizeVisualHints(value: unknown): WebsiteVisualHints {
  if (!value || typeof value !== "object") return { colors: [], socialLinks: {}, logoUrl: null };
  const input = value as Record<string, unknown>;
  const colors = Array.isArray(input.colors) ? input.colors.filter((item): item is string => typeof item === "string").slice(0, 10) : [];
  const socialLinks = input.socialLinks && typeof input.socialLinks === "object" ? Object.fromEntries(Object.entries(input.socialLinks as Record<string, unknown>).filter(([, item]) => typeof item === "string").map(([key, item]) => [key, String(item)])) : {};
  const logoUrl = typeof input.logoUrl === "string" ? input.logoUrl : null;
  return { colors, socialLinks, logoUrl };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  const token = bearer(req);
  if (!token) return res.status(401).json({ error: "AUTH_REQUIRED" });
  if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: "OPENAI_NOT_CONFIGURED" });
  const profileId = typeof req.body?.profileId === "string" ? req.body.profileId : "";
  if (!profileId) return res.status(400).json({ error: "PROFILE_REQUIRED" });
  const visualHints = sanitizeVisualHints(req.body?.visualHints);

  try {
    const profiles = await rows<ProfileRow>(`profiles?id=eq.${encodeURIComponent(profileId)}&select=id,name,website_url,industry&limit=1`, token);
    const profile = profiles[0];
    if (!profile) return res.status(404).json({ error: "PROFILE_NOT_FOUND" });
    const scans = await rows<ScanRow>(`website_scans?profile_id=eq.${encodeURIComponent(profileId)}&state=in.(COMPLETE,PARTIAL)&select=id&order=created_at.desc&limit=1`, token);
    if (!scans[0]) return res.status(409).json({ error: "WEBSITE_SCAN_REQUIRED" });
    const pageRows = await rows<PageRow>(`website_pages?scan_id=eq.${encodeURIComponent(scans[0].id)}&profile_id=eq.${encodeURIComponent(profileId)}&status=eq.ANALYZED&select=url,title,content_text&order=depth.asc&limit=100`, token);
    const pages = pageRows.filter((page) => Boolean(page.content_text)).map((page) => ({ url: page.url, title: page.title, text: page.content_text ?? "" }));
    if (!pages.length) return res.status(409).json({ error: "NO_ANALYZED_WEBSITE_PAGES" });

    const result = await analyzeBrandFromWebsite({ apiKey: process.env.OPENAI_API_KEY, profileName: profile.name, websiteUrl: profile.website_url, industry: profile.industry, pages, visualHints });
    const existingRows = await rows<ExistingBrand>(`brand_profiles?profile_id=eq.${encodeURIComponent(profileId)}&select=profile_id,social_links&limit=1`, token);
    const existingSocials = existingRows[0]?.social_links && typeof existingRows[0].social_links === "object" ? existingRows[0].social_links as Record<string, unknown> : {};
    const socialLinks = { ...visualHints.socialLinks, ...Object.fromEntries(Object.entries(existingSocials).filter(([, value]) => typeof value === "string" && value)) };
    const now = new Date().toISOString();
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
      visual_identity: { observedColors: visualHints.colors, logoUrl: visualHints.logoUrl, summary: result.analysis.visualStyleSummary, source: "website_scan" },
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

    const usageWrite = await dataApi("ai_usage_events", token, { method: "POST", headers: { prefer: "return=minimal" }, body: JSON.stringify({ profile_id: profileId, operation: "ANALYZE_BRAND_ONBOARDING", model: result.model, input_tokens: result.usage.inputTokens, output_tokens: result.usage.outputTokens, cost_usd: result.usage.estimatedCostUsd, metadata: { openai_response_id: result.responseId, openai_request_id: result.requestId, pages_analyzed: pages.length } }) });
    if (!usageWrite.ok) console.error("onboarding-usage-write", { profileId, status: usageWrite.status });

    return res.status(200).json({ analysis: result.analysis, visualHints, pagesAnalyzed: pages.length, model: result.model });
  } catch (reason) {
    const detail = reason instanceof Error ? reason.message : "UNKNOWN_ONBOARDING_ANALYSIS_ERROR";
    console.error("onboarding-analyze", { profileId, detail });
    return res.status(detail.startsWith("OPENAI_") ? 502 : 500).json({ error: "ONBOARDING_ANALYSIS_FAILED", detail });
  }
}
