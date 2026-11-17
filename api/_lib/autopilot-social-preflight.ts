import type { SocialProvider } from "./openai-text.js";

/**
 * No autonomous paid generation unless the exact destination account was
 * recently confirmed by the provider. This avoids paying for drafts that
 * cannot be scheduled or published.
 *
 * An expired GBP ACCESS token is permitted when the connection remains
 * verified: its refresh token is handled at publish-time. Other expired
 * access tokens fail closed.
 */
export type AutopilotSocialConnection = {
  provider: SocialProvider;
  status: string;
  has_token: boolean;
  has_account: boolean;
  last_validated_at: string | Date | null;
  expires_at: string | Date | null;
};

export const SOCIAL_PREFLIGHT_MAX_AGE_MS = 48 * 60 * 60 * 1000;

function timestamp(value: string | Date | null): number {
  if (!value) return NaN;
  return value instanceof Date ? value.getTime() : Date.parse(value);
}

export function verifiedAutopilotProviders(
  rows: readonly AutopilotSocialConnection[],
  now: Date = new Date(),
): Set<SocialProvider> {
  const verified = new Set<SocialProvider>();
  const currentTime = now.getTime();
  if (!Number.isFinite(currentTime)) return verified;
  for (const row of rows) {
    if (row.status !== "ACTIVE" || row.has_token !== true || row.has_account !== true) continue;
    const checkedAt = timestamp(row.last_validated_at);
    if (!Number.isFinite(checkedAt) || checkedAt > currentTime ||
        currentTime - checkedAt > SOCIAL_PREFLIGHT_MAX_AGE_MS) continue;
    if (row.provider !== "GBP" && row.expires_at) {
      const expiry = timestamp(row.expires_at);
      if (!Number.isFinite(expiry) || expiry <= currentTime) continue;
    }
    verified.add(row.provider);
  }
  return verified;
}
