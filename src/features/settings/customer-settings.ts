export type CustomerEntitlement = {
  capability_key: string;
  enabled: boolean;
  limit_value: number | string | null;
  period_type: string;
  source: string;
};

export type CustomerUsageBucket = {
  capability_key: string;
  committed_quantity: number | string;
  reserved_quantity: number | string;
};

export type CustomerUsage = { label: string; used: number; limit: number | null; periodLabel: string };
export type CustomerPlan = { name: string; features: string[]; usage: CustomerUsage[] };

const CUSTOMER_FEATURES: Record<string, { label: string; usageLabel?: string }> = {
  "brand.analyze": { label: "Analisi del brand", usageLabel: "analisi del brand" },
  "ai.content.generate_text": { label: "Creazione contenuti con AI", usageLabel: "contenuti AI" },
  "ai.strategy.generate": { label: "Strategia editoriale con AI", usageLabel: "strategie AI" },
  "ai.image.generate": { label: "Creazione immagini con AI", usageLabel: "immagini AI" },
  "content.approval.auto": { label: "Approvazione automatica" },
  "autopilot.manage": { label: "Autopilot" },
  "social.publish.scheduled": { label: "Pubblicazione programmata" },
};

function finite(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function periodLabel(value: string) {
  if (value === "DAY") return "oggi";
  if (value === "MONTH") return "questo mese";
  return "nel periodo corrente";
}

export function buildCustomerPlan(entitlements: CustomerEntitlement[], buckets: CustomerUsageBucket[]): CustomerPlan {
  const currentUsage = new Map(buckets.map((row) => [row.capability_key, finite(row.committed_quantity) + finite(row.reserved_quantity)]));
  const visible = entitlements.filter((row) => row.enabled && CUSTOMER_FEATURES[row.capability_key]);
  const packaged = entitlements.some((row) => row.source.startsWith("PACKAGE:"));
  return {
    name: packaged ? "Piano assegnato" : "Piano personale",
    features: visible.map((row) => CUSTOMER_FEATURES[row.capability_key].label),
    usage: visible.flatMap((row) => {
      const definition = CUSTOMER_FEATURES[row.capability_key];
      if (!definition.usageLabel) return [];
      const numericLimit = row.limit_value === null ? null : finite(row.limit_value);
      return [{ label: definition.usageLabel, used: currentUsage.get(row.capability_key) ?? 0, limit: numericLimit, periodLabel: periodLabel(row.period_type) }];
    }),
  };
}

export type SettingsSocialProvider = "INSTAGRAM" | "FACEBOOK" | "LINKEDIN" | "GBP";
export type SettingsSocialStatus = { provider: SettingsSocialProvider; configured: boolean; status: string; permissions: string[] };

const SOCIAL_LABELS: Record<SettingsSocialProvider, string> = {
  INSTAGRAM: "Instagram",
  FACEBOOK: "Facebook",
  LINKEDIN: "LinkedIn",
  GBP: "Google Business Profile",
};

export function customerSocialState(row: SettingsSocialStatus) {
  if (!row.configured || row.provider === "GBP") return { label: SOCIAL_LABELS[row.provider], state: "Non disponibile" };
  if (row.status !== "ACTIVE") return { label: SOCIAL_LABELS[row.provider], state: "Da riconnettere" };
  if (row.provider === "INSTAGRAM" && !row.permissions.includes("instagram_manage_insights")) return { label: SOCIAL_LABELS[row.provider], state: "Permesso Analytics mancante" };
  if (row.provider === "LINKEDIN" && !row.permissions.includes("r_member_postAnalytics") && !row.permissions.includes("rw_organization_admin")) return { label: SOCIAL_LABELS[row.provider], state: "Permesso Analytics mancante" };
  return { label: SOCIAL_LABELS[row.provider], state: "Collegato" };
}
