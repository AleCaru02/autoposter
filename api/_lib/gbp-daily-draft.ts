/**
 * Fail-closed configuration for the isolated GBP daily draft pilot.
 * Generating drafts does not authorize or perform a Google Business write.
 */
export type GbpDailyDraftConfig = {
  GBP_DAILY_DRAFT_ENABLED?: string;
  GBP_DAILY_PROFILE_ID?: string;
  SOCIAL_PILOT_PROFILE_ID?: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function resolveGbpDailyDraftConfig(env: GbpDailyDraftConfig):
  | { allowed: true; profileId: string }
  | { allowed: false; reason: "DISABLED" | "INVALID_PROFILE_SCOPE" } {
  if(env.GBP_DAILY_DRAFT_ENABLED?.trim().toLowerCase()!=="true") return {allowed:false,reason:"DISABLED"};
  const id=env.GBP_DAILY_PROFILE_ID?.trim()??"";
  if(!UUID.test(id)||id!==env.SOCIAL_PILOT_PROFILE_ID?.trim()) return {allowed:false,reason:"INVALID_PROFILE_SCOPE"};
  return {allowed:true,profileId:id};
}
