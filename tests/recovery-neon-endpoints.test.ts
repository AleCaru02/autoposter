import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const files = [
  "src/lib/neon-client.ts",
  "api/_lib/verified-customer-auth.ts",
  "cloudflare/auth-proxy.ts",
  "cloudflare/editorial-agents.ts",
  "cloudflare/entry.ts",
  "cloudflare/generate-text.ts",
  "cloudflare/managed-auth-capabilities.ts",
  "cloudflare/onboarding-analyze.ts",
  "cloudflare/platform-rbac.ts",
  "cloudflare/tenant-security.ts",
  "cloudflare/worker.ts",
];

const oldHost = "ep-nameless-truth-a698bwer";
const recoveryHost = "ep-divine-band-arrkz7vq";
for (const path of files) {
  const source = readFileSync(path, "utf8");
  assert.ok(!source.includes(oldHost), `${path} must not reference the blocked Neon project`);
  assert.ok(source.includes(recoveryHost), `${path} must point to the recovery Neon project`);
}

const authProxy = readFileSync("cloudflare/auth-proxy.ts", "utf8");
assert.match(authProxy, /ep-divine-band-arrkz7vq\.neonauth\.c-4\.us-west-2\.aws\.neon\.tech\/neondb\/auth/);

const worker = readFileSync("cloudflare/worker.ts", "utf8");
assert.match(worker, /ep-divine-band-arrkz7vq\.apirest\.c-4\.us-west-2\.aws\.neon\.tech\/neondb\/rest\/v1/);

const client = readFileSync("src/lib/neon-client.ts", "utf8");
assert.match(client, /ep-divine-band-arrkz7vq\.apirest\.c-4\.us-west-2\.aws\.neon\.tech\/neondb\/rest\/v1/);

const verifiedCustomerAuth = readFileSync("api/_lib/verified-customer-auth.ts", "utf8");
assert.match(verifiedCustomerAuth, /ep-divine-band-arrkz7vq\.apirest\.c-4\.us-west-2\.aws\.neon\.tech\/neondb\/rest\/v1/);

console.log("recovery Neon endpoint regression: PASS");
