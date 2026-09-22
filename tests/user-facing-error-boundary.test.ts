import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function source(path: string) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

const [
  socialApi,
  vercelAutopilot,
  vercelImage,
  workerEntry,
  workerLegacy,
  socialPage,
  contentStore,
  autopilotStore,
  calendarStore,
  profileContext,
  brandPage,
  websitePage,
  approvalsPage,
  contentPage,
] = await Promise.all([
  source("api/_lib/social.ts"),
  source("api/autopilot.ts"),
  source("api/generate-image.ts"),
  source("cloudflare/entry.ts"),
  source("cloudflare/worker.ts"),
  source("src/pages/social-page.tsx"),
  source("src/features/content/content-store.ts"),
  source("src/features/content/autopilot-store.ts"),
  source("src/features/calendar/calendar-store.ts"),
  source("src/features/profiles/profile-context.tsx"),
  source("src/pages/brand-page.tsx"),
  source("src/pages/website-scan-page.tsx"),
  source("src/pages/approvals-page.tsx"),
  source("src/pages/content-generator-page.tsx"),
]);

assert.match(socialApi, /function publicOAuthErrorCode\(/, "OAuth failures need a public-code allowlist");
assert.match(socialApi, /social_error: publicOAuthErrorCode\(provider, errorCode\)/, "OAuth callback must sanitize provider failures");
assert.doesNotMatch(socialApi, /redirectWithStatus\([^\n]*error_description/, "provider descriptions must not reach the callback query string");
assert.doesNotMatch(socialApi, /SOCIAL_SELECTION_FAILED", detail/, "selection response must not expose raw provider or database details");
assert.doesNotMatch(socialApi, /ASSET_READ_FAILED", detail/, "asset response must not expose raw storage details");

for (const [name, code] of [["Vercel autopilot", vercelAutopilot], ["Vercel image", vercelImage], ["legacy Worker", workerLegacy]] as const) {
  assert.doesNotMatch(code, /json\(\{ error: "(?:AUTOPILOT_RUN_FAILED|IMAGE_GENERATION_FAILED|GENERATION_FAILED)"\s*,\s*detail\s*\}/, `${name} must not return internal details`);
}
assert.match(workerEntry, /learning-profile-failed/, "learning runtime failures must retain server-side diagnostics");
assert.match(workerEntry, /return json\(\{ error: "LEARNING_RUN_FAILED" \}, 500\)/, "learning failures need a stable public response");
assert.match(workerEntry, /social-api-failed/, "social failures must retain server-side diagnostics");
assert.match(workerEntry, /return json\(\{ error: "SOCIAL_API_FAILED" \}, 500\)/, "social failures need a stable public response");

assert.match(socialPage, /Collegamento non riuscito\. Riprova tra poco\./, "unknown social codes need a friendly fallback");
assert.doesNotMatch(websitePage, /return value \|\| fallback/, "website errors must not render untrusted API details");
assert.doesNotMatch(approvalsPage, /throw new Error\(body\.(?:detail|message|error)/, "image errors must not be rendered verbatim");
assert.doesNotMatch(contentPage, /throw new Error\(body\.(?:detail|message|error)/, "autopilot errors must not be rendered verbatim");

for (const [name, code] of [
  ["content store", contentStore],
  ["autopilot store", autopilotStore],
  ["calendar store", calendarStore],
  ["profile context", profileContext],
  ["brand page", brandPage],
  ["website page", websitePage],
] as const) {
  assert.doesNotMatch(code, /(?:throw new Error|set[A-Za-z]*Error)\([^\n]*\.error(?:\?)*\.message/, `${name} must not render PostgREST errors verbatim`);
}

console.log("User-facing error boundary: PASS");
