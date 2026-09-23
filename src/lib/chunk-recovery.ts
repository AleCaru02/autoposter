type RecoveryRuntime = {
  storage: Pick<Storage, "getItem" | "setItem">;
  reload: () => void;
};

const RETRY_KEY = "post-automatici:chunk-recovery";
const RETRY_WINDOW_MS = 5 * 60 * 1000;

// A deployment can replace a lazy route's asset while an older tab is open.
// Reload at most once per retry window; persistent network failures get a UI.
export function recoverMissingChunk(error: unknown, runtime: RecoveryRuntime, now = Date.now()): boolean {
  if (!(error instanceof Error) || !/Failed to fetch dynamically imported module|Importing a module script failed|Loading chunk .+ failed/i.test(error.message)) return false;
  try {
    const lastAttempt = Number(runtime.storage.getItem(RETRY_KEY));
    if (lastAttempt > 0 && now - lastAttempt < RETRY_WINDOW_MS) return false;
    runtime.storage.setItem(RETRY_KEY, String(now));
    runtime.reload();
    return true;
  } catch {
    return false;
  }
}
