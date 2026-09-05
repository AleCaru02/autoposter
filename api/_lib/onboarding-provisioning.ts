import { neon } from "@neondatabase/serverless";

export type OnboardingProvisionInput = {
  operationId: string;
  name: string;
  websiteUrl?: string | null;
  industry?: string | null;
};

export type ProvisionedProfile = {
  id: string;
  name: string;
  slug: string;
  website_url: string | null;
  industry: string | null;
  timezone: string;
  locale: string;
  onboarding_completed: boolean;
  created_at: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function optionalText(value: unknown, max: number) {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new Error("ONBOARDING_INPUT_INVALID");
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > max) throw new Error("ONBOARDING_INPUT_INVALID");
  return normalized;
}

function website(value: unknown) {
  const normalized = optionalText(value, 2048);
  if (!normalized) return null;
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error();
    return parsed.toString();
  } catch {
    throw new Error("ONBOARDING_WEBSITE_INVALID");
  }
}

function slugify(name: string, operationId: string) {
  const base = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 58) || "attivita";
  return `${base}-${operationId.replace(/-/g, "").slice(0, 8)}`;
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (item) => item.toString(16).padStart(2, "0")).join("");
}

export async function provisionOnboardingProfile(databaseUrl: string, authUserId: string, raw: OnboardingProvisionInput) {
  const operationId = typeof raw.operationId === "string" ? raw.operationId.trim() : "";
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!UUID.test(operationId) || !name || name.length > 160) throw new Error("ONBOARDING_INPUT_INVALID");
  const websiteUrl = website(raw.websiteUrl);
  const industry = optionalText(raw.industry, 160);
  const normalized = { name, websiteUrl, industry };
  const fingerprint = await sha256(JSON.stringify(normalized));
  const slug = slugify(name, operationId);
  const sql = neon(databaseUrl);
  const rows = await sql`
    select * from public.provision_onboarding_profile(
      ${authUserId}, ${operationId}::uuid, ${fingerprint}, ${name}, ${slug},
      ${websiteUrl}, ${industry}
    )
  ` as unknown as ProvisionedProfile[];
  if (!rows[0]) throw new Error("ONBOARDING_PROVISIONING_FAILED");
  return rows[0];
}
