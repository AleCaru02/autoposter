export const NEW_ACTIVITY_FLOW_KEY = "post-automatici.new-activity-flow";

type NewActivityFlow = { createdProfileId: string };

export function readNewActivityFlow(): NewActivityFlow | null {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(NEW_ACTIVITY_FLOW_KEY) || "null") as NewActivityFlow | null;
    if (parsed?.createdProfileId && /^[0-9a-f-]{36}$/i.test(parsed.createdProfileId)) return parsed;
  } catch { /* invalid browser state is cleared below */ }
  sessionStorage.removeItem(NEW_ACTIVITY_FLOW_KEY);
  return null;
}

export function rememberNewActivityProfile(createdProfileId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(createdProfileId)) throw new Error("INVALID_NEW_ACTIVITY_PROFILE_ID");
  sessionStorage.setItem(NEW_ACTIVITY_FLOW_KEY, JSON.stringify({ createdProfileId } satisfies NewActivityFlow));
}

export function clearNewActivityFlow() {
  sessionStorage.removeItem(NEW_ACTIVITY_FLOW_KEY);
}
