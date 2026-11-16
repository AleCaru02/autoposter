import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const login = readFileSync(new URL("../src/pages/auth-pages.tsx", import.meta.url), "utf8");
const guard = app.slice(app.indexOf("export function useConfirmedSession"), app.indexOf("function RequireProfile"));
assert.match(guard, /session\.refetch\?\.\(\)/, "an empty cached session is re-checked against the server before redirecting");
assert.match(guard, /session\.isRefetching/, "a refetch in progress must not trigger a redirect");
assert.match(guard, /if \(checking && !user\) return <main className="center-state">Verifica sessione…<\/main>;/);
assert.ok(guard.indexOf("Verifica sessione") < guard.indexOf('<Navigate to="/login" replace />'), "redirect to /login only after the check");
// Regression (preview iPhone, 14/11): a LoginPage redirect based on the cached session bounced
// users back into the app right after sign-out and caused a get-session polling loop.
assert.doesNotMatch(login, /existingSession|alreadySignedIn/, "the login page must not auto-redirect from a possibly stale cached session");
// After sign-out the session client can stay pending and refetch forever: the guard must give up
// after a bounded wait and send the user to /login (verified on iPhone WebKit, 15/11/2026).
{
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(app, /SESSION_CHECK_TIMEOUT_MS = \d{4}/);
  assert.match(app, /const checking = !timedOut &&/, "the wait is bounded");
  assert.match(app, /function RootRedirect\(\) \{\s+const \{ checking, user \} = useConfirmedSession\(\);/, "root redirect uses the same bounded check");
}
{
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  // 16/11: after sign-out the session client refetched every ~300 ms and the guard always waited the full timeout.
  assert.match(app, /fetch\("\/api\/auth\/get-session", \{ credentials: "include", cache: "no-store"/, "an uncached server check confirms the sign-out");
  assert.match(app, /!\(serverSignedOut && !hasUser\)/, "a confirmed sign-out redirects without waiting for the timeout");
  assert.match(app, /if \(hasUser\) setServerSignedOut\(false\)/, "a later successful login clears the signed-out flag");
}
console.log("PASS auth session race: niente rimbalzo su /login dopo un accesso riuscito; attesa sessione limitata dopo il logout.");
