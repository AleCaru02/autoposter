import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const login = readFileSync(new URL("../src/pages/auth-pages.tsx", import.meta.url), "utf8");
const guard = app.slice(app.indexOf("export function useConfirmedSession"), app.indexOf("function RequireProfile"));
assert.match(guard, /session\.refetch\?\.\(\)/, "an empty cached session is re-checked against the server before redirecting");
assert.match(guard, /session\.isRefetching/, "a refetch in progress must not trigger a redirect");
assert.match(guard, /if \(checking && !user\) return <main className="center-state">Verifica sessione…<\/main>;/);
assert.ok(guard.indexOf("Verifica sessione") < guard.indexOf('<Navigate to="/login" replace />'), "redirect to /login only after the check");
assert.match(login, /if \(alreadySignedIn && !busy\) navigate\("\/app\/dashboard", \{ replace: true \}\);/, "a signed-in user is never stranded on the login form");
assert.match(login, /const alreadySignedIn = Boolean\(existingSession\.data\?\.user\) && !oauthError;/, "OAuth error returns stay on the login page to show the error");
console.log("PASS auth session race: niente rimbalzo su /login dopo un accesso riuscito.");
