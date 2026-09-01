import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const testsDir = dirname(fileURLToPath(import.meta.url));
const sourcePath = join(testsDir, "admin-impersonation-provider-runtime.mjs");
const runtimePath = join(testsDir, ".admin-impersonation-provider-browser-runtime.mjs");
let source = await readFile(sourcePath, "utf8");

function replaceOnce(label, from, to) {
  const first = source.indexOf(from);
  assert.ok(first >= 0, `${label}: source anchor missing`);
  assert.equal(source.indexOf(from, first + from.length), -1, `${label}: source anchor is ambiguous`);
  source = `${source.slice(0, first)}${to}${source.slice(first + from.length)}`;
}

const oldTransport = `function authRequestHeaders() {
  return { accept: "application/json", origin: APP_BASE, referer: \`\${APP_BASE}/\`, "content-type": "application/json" };
}

async function browserAuthPost(context, path, payload) {
  const response = await context.request.post(\`\${AUTH_URL}\${path}\`, { headers: authRequestHeaders(), data: payload ?? {} });
  const body = await readJson(response);
  return { response, status: response.status(), body };
}

async function browserGetSession(context) {
  const response = await context.request.get(\`\${AUTH_URL}/get-session\`, { headers: { accept: "application/json", origin: APP_BASE, referer: \`\${APP_BASE}/\` } });
  const body = await readJson(response);
  return { status: response.status(), body, ...sessionInfoFromBody(body) };
}`;

const pageTransport = `async function browserAuthPost(page, path, payload) {
  const result = await page.evaluate(async ({ url, payload }) => {
    const response = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(payload ?? {}),
    });
    const text = await response.text();
    let body = null;
    if (text) { try { body = JSON.parse(text); } catch { body = null; } }
    return { status: response.status, ok: response.ok, body };
  }, { url: \`\${AUTH_URL}\${path}\`, payload: payload ?? {} });
  return { response: { ok: () => result.ok }, status: result.status, body: result.body };
}

async function browserGetSession(page) {
  const result = await page.evaluate(async (url) => {
    const response = await fetch(url, { credentials: "include", headers: { accept: "application/json" } });
    const text = await response.text();
    let body = null;
    if (text) { try { body = JSON.parse(text); } catch { body = null; } }
    return { status: response.status, body };
  }, \`\${AUTH_URL}/get-session\`);
  return { status: result.status, body: result.body, ...sessionInfoFromBody(result.body) };
}`;

replaceOnce("browser transport", oldTransport, pageTransport);

const getSessionCalls = (source.match(/browserGetSession\(context\)/g) || []).length;
assert.equal(getSessionCalls, 4, `expected 4 browser context session calls, found ${getSessionCalls}`);
source = source.replaceAll("browserGetSession(context)", "browserGetSession(page)");

const authPostCalls = (source.match(/browserAuthPost\(context,/g) || []).length;
assert.equal(authPostCalls, 2, `expected 2 browser context auth POST calls, found ${authPostCalls}`);
source = source.replaceAll("browserAuthPost(context,", "browserAuthPost(page,");

replaceOnce(
  "browser start response checks",
  `  assert.ok(browserStart.response.ok(), \`browser native impersonation start failed (\${browserStart.status})\`);
  const browserImpersonated = await browserGetSession(page);
  assert.equal(browserImpersonated.userId, customer.id);
  assert.equal(browserImpersonated.impersonatedBy, admin.id);`,
  `  assert.ok(browserStart.response.ok(), \`browser native impersonation start failed (\${browserStart.status})\`);
  const browserStartResponseSession = sessionInfoFromBody(browserStart.body);
  assert.equal(browserStartResponseSession.userId, customer.id, "browser native start response did not identify CUSTOMER_A");
  assert.equal(browserStartResponseSession.impersonatedBy, admin.id, "browser native start response did not identify origin Admin");
  const browserImpersonated = await browserGetSession(page);
  assert.equal(browserImpersonated.userId, customer.id, "browser cookie session did not switch to CUSTOMER_A after in-page native start");
  assert.equal(browserImpersonated.impersonatedBy, admin.id, "browser cookie session did not retain origin Admin after in-page native start");`,
);

replaceOnce(
  "stale browser context probe",
  `  const oldContext = await browser.newContext({ storageState: oldStorageState, viewport: { width: 390, height: 844 } });
  const stale = await browserGetSession(oldContext);
  assert.ok(!(stale.active && stale.userId === customer.id), "browser old impersonated storage state remained active after stop");
  await oldContext.close();`,
  `  const oldContext = await browser.newContext({ storageState: oldStorageState, viewport: { width: 390, height: 844 } });
  const oldPage = await oldContext.newPage();
  await oldPage.goto(\`\${APP_BASE}/\`, { waitUntil: "domcontentloaded", timeout: 30000 });
  const stale = await browserGetSession(oldPage);
  assert.ok(!(stale.active && stale.userId === customer.id), "browser old impersonated storage state remained active after stop");
  await oldContext.close();`,
);

assert.doesNotMatch(source, /context\.request\.(post|get)\(/, "patched verifier still uses BrowserContext.request for provider session mutation");
assert.match(source, /credentials:\s*"include"/, "patched verifier is missing real browser credential propagation");

await writeFile(runtimePath, source, { encoding: "utf8", mode: 0o600 });
try {
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [runtimePath], { stdio: "inherit", env: process.env });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve(signal ? 1 : (code ?? 1)));
  });
  process.exitCode = exitCode;
} finally {
  await unlink(runtimePath).catch(() => {});
}
