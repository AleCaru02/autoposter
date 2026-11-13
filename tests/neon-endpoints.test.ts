import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isIsolatedPreview, neonAuthUrl, neonDataApiUrl, PRODUCTION_NEON_AUTH_URL, PRODUCTION_NEON_DATA_API_URL } from "../api/_lib/neon-endpoints.js";

const qaData = "https://ep-fragrant-mud-ara6ysty.apirest.c-4.us-west-2.aws.neon.tech/neondb/rest/v1";
const qaAuth = "https://ep-fragrant-mud-ara6ysty.neonauth.c-4.us-west-2.aws.neon.tech/neondb/auth";

assert.equal(neonDataApiUrl({}), PRODUCTION_NEON_DATA_API_URL);
assert.equal(neonDataApiUrl({ VERCEL_ENV: "production", NEON_DATA_API_URL: qaData }), PRODUCTION_NEON_DATA_API_URL, "production can never be redirected");
assert.equal(neonDataApiUrl({ VERCEL_ENV: "preview", NEON_DATA_API_URL: qaData }), qaData);
assert.equal(neonAuthUrl({ VERCEL_ENV: "preview", NEON_AUTH_URL: qaAuth }), qaAuth);
for (const bad of ["https://evil.example/neondb/rest/v1", "http://ep-x.apirest.c-4.us-west-2.aws.neon.tech/neondb/rest/v1", `${qaData}/../admin`, qaAuth]) {
  assert.equal(neonDataApiUrl({ VERCEL_ENV: "preview", NEON_DATA_API_URL: bad }), PRODUCTION_NEON_DATA_API_URL, `rejected: ${bad}`);
}
assert.equal(neonAuthUrl({ VERCEL_ENV: "preview", NEON_AUTH_URL: qaData }), PRODUCTION_NEON_AUTH_URL, "a Data API URL is not an Auth URL");
assert.equal(isIsolatedPreview({ VERCEL_ENV: "preview", NEON_DATA_API_URL: qaData, NEON_AUTH_URL: qaAuth }), true);
assert.equal(isIsolatedPreview({ VERCEL_ENV: "preview", NEON_DATA_API_URL: qaData }), false, "half-configured previews are not isolated");

// No Vercel API route may hardcode the production Data API any more.
for (const file of ["api/autopilot.ts", "api/render.ts", "api/generate-image.ts", "api/_lib/social.ts", "api/_lib/verified-customer-auth.ts", "api/profile-bootstrap.ts", "cloudflare/auth-proxy.ts", "src/lib/neon-client.ts"]) {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  assert.ok(/neonDataApiUrl\(\)|neonAuthUrl\(\)|__NEON_DATA_API_URL__/.test(source), `${file} must resolve endpoints through the preview-safe resolver`);
}
assert.match(readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8"), /__NEON_DATA_API_URL__: JSON\.stringify\(neonDataApiUrl\(process\.env\)\)/);
console.log("PASS neon endpoints: produzione blindata, preview isolata solo con URL Neon validi per Data API e Auth.");
