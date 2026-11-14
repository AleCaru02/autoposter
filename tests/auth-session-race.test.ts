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
console.log("PASS auth session race: niente rimbalzo su /login dopo un accesso riuscito.");
