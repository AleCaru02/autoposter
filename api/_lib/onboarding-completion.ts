import { neon } from "@neondatabase/serverless";

export type OnboardingCompletionMode = "NO_WEBSITE" | "BRAND_ANALYZED";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function completeOnboardingProfile(
  databaseUrl: string,
  authUserId: string,
  profileId: string,
  mode: OnboardingCompletionMode,
) {
  if (!UUID.test(profileId) || !authUserId.trim()) throw new Error("ONBOARDING_COMPLETION_INPUT_INVALID");
  const sql = neon(databaseUrl);
  const rows = await sql`
    select public.complete_onboarding_profile(
      ${authUserId}, ${profileId}::uuid, ${mode}
    ) as completed
  ` as unknown as Array<{ completed: boolean }>;
  if (rows[0]?.completed !== true) throw new Error("ONBOARDING_COMPLETION_FAILED");
  return true;
}
