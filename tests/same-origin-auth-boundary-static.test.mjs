import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function read(relative) {
  return fs.readFileSync(relative, "utf8");
}

function sourceFiles(root) {
  const output = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) output.push(...sourceFiles(full));
    else if (/\.(?:ts|tsx|js|jsx|mjs)$/.test(entry.name)) output.push(full);
  }
  return output;
}

const client = read("src/lib/neon-client.ts");
const proxy = read("cloudflare/auth-proxy.ts");
const entry = read("cloudflare/entry.ts");
const frontend = sourceFiles("src").map((file) => `${file}\n${read(file)}`).join("\n");

const providerHost = "ep-nameless-truth-a698bwer.neonauth.us-west-2.aws.neon.tech";
const providerUrl = `https://${providerHost}/neondb/auth`;

assert.match(client, /SAME_ORIGIN_AUTH_PATH = "\/api\/auth"/);
assert.match(client, /window\.location\.origin/);
assert.equal(client.includes("neonauth"), false, "browser Auth client must not contain direct Neon Auth hostname");
assert.equal(frontend.includes(providerHost), false, "production frontend must have zero direct Neon Auth references");
assert.equal(frontend.includes(providerUrl), false, "production frontend must not retain a direct Auth fallback");

assert.equal((proxy.match(new RegExp(providerHost.replace(/\./g, "\\."), "g")) || []).length, 1, "proxy must define exactly one fixed Neon Auth upstream");
assert.match(proxy, /const AUTH_UPSTREAM = "https:\/\/ep-nameless-truth-a698bwer\.neonauth\.us-west-2\.aws\.neon\.tech\/neondb\/auth"/);
assert.match(proxy, /const AUTH_PREFIX = "\/api\/auth"/);
assert.match(proxy, /FORBIDDEN_PROXY_QUERY_KEYS = new Set\(\["url", "upstream"\]\)/);
assert.match(proxy, /FORWARDED_FROM_CLIENT/);
assert.match(proxy, /x-forwarded-host/);
assert.match(proxy, /x-forwarded-proto/);
assert.match(proxy, /forwarded/);
assert.doesNotMatch(proxy, /request\.headers\.get\(["'](?:x-forwarded-host|x-forwarded-proto|forwarded)["']\)/i);
assert.match(proxy, /request\.method !== "GET" && request\.method !== "POST"/);
assert.match(proxy, /request\.headers\.get\("origin"\)/);
assert.match(proxy, /origin !== appOrigin/);
assert.match(proxy, /rawPathUnsafe/);
assert.match(proxy, /decodeURIComponent/);
assert.match(proxy, /getSetCookie/);
assert.match(proxy, /cache-control["'], ["']no-store/i);
assert.match(proxy, /pragma["'], ["']no-cache/i);
assert.doesNotMatch(proxy, /console\.(?:log|error|warn)/, "Auth proxy must not log request/response material");
assert.doesNotMatch(proxy, /jwt\.sign|createToken|session[_ ]table|insert\s+into\s+neon_auth\.session/i);
assert.doesNotMatch(proxy, /localStorage|sessionStorage|document\.cookie/i);
assert.doesNotMatch(proxy, /trustedOrigins\s*[:=]\s*\[[^\]]*["']\*["']/i);
assert.doesNotMatch(proxy, /fetch\s*\(\s*(?:request\.url|url\.toString\(\)|new URL\(request\.url\))/i, "proxy fetch target must not derive from client URL");

const blockLegacy = 'if (path === "/api/auth/account-exists") return json({ error: "API_NOT_FOUND" }, 404);';
const proxyCall = "const authProxyResponse = await handleSameOriginAuthProxy(request, env);";
assert.equal(entry.includes(blockLegacy), true, "legacy account-existence endpoint must remain blocked");
assert.equal(entry.includes(proxyCall), true, "Worker entry must route same-origin Auth proxy");
assert.ok(entry.indexOf(blockLegacy) < entry.indexOf(proxyCall), "legacy account-existence endpoint must remain blocked before Auth forwarding");
assert.ok(entry.indexOf(proxyCall) < entry.indexOf("return worker.fetch(request, env);"), "Auth proxy must execute before generic asset/API fallback");

assert.equal(entry.includes("/api/admin/customers/:id/impersonate"), false, "Impersonation API must not be introduced in Auth boundary PR");
assert.equal(entry.includes("/api/admin/impersonation/stop"), false, "Impersonation stop API must not be introduced in Auth boundary PR");

console.log("same-origin Auth boundary static security: PASS");
