import assert from "node:assert/strict";

const APP_BASE = "https://autoposter.02alessandrocaruso.workers.dev";
const DATA_API = "https://ep-divine-band-arrkz7vq.apirest.c-4.us-west-2.aws.neon.tech/neondb/rest/v1";
const WEBSITE_URL = "https://iltuopropertymanager.it/";
const marker = process.env.CRAWLER_QA_MARKER || "";
const password = process.env.CRAWLER_QA_PASSWORD || "";
const controllerUrl = process.env.CRAWLER_QA_CONTROLLER_URL || "";
const controllerToken = process.env.CRAWLER_QA_TOKEN_VALUE || "";

assert.match(marker, /^[a-z0-9]{10,32}$/);
assert.ok(password.length >= 24, "ephemeral QA password missing");
assert.ok(controllerUrl.startsWith("https://"), "preview controller URL missing");
assert.ok(controllerToken.length >= 32, "preview controller token missing");

const email = `crawler-smoke-${marker}@example.invalid`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class CookieJar {
  constructor() { this.values = new Map(); }
  absorb(headers) {
    for (const raw of headers.getSetCookie?.() || []) {
      const pair = raw.split(";", 1)[0];
      const index = pair.indexOf("=");
      if (index > 0) this.values.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
    }
  }
  header() { return [...this.values.entries()].map(([key, value]) => `${key}=${value}`).join("; "); }
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); }
  catch { return { invalidJson: true, preview: text.slice(0, 160) }; }
}

async function authCall(jar, route, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  headers.set("origin", APP_BASE);
  headers.set("referer", `${APP_BASE}/`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const cookie = jar.header();
  if (cookie) headers.set("cookie", cookie);
  const response = await fetch(`${APP_BASE}/api/auth/${route}`, { ...init, headers, redirect: "manual" });
  jar.absorb(response.headers);
  return response;
}

function decodeSub(token) {
  const payload = token.split(".")[1];
  assert.ok(payload, "JWT payload missing");
  const normalized = payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=");
  const body = JSON.parse(Buffer.from(normalized, "base64").toString("utf8"));
  assert.equal(typeof body.sub, "string");
  return body.sub;
}

async function signUp() {
  const jar = new CookieJar();
  const signup = await authCall(jar, "sign-up/email", {
    method: "POST",
    body: JSON.stringify({ email, password, name: "Crawler Runtime QA" }),
  });
  assert.ok(signup.ok, `Managed Auth signup failed (${signup.status})`);
  const tokenResponse = await authCall(jar, "token");
  const tokenBody = await readJson(tokenResponse);
  const token = tokenBody?.token || tokenBody?.data?.token || "";
  assert.ok(tokenResponse.ok && token.length > 40, `Managed Auth token unavailable (${tokenResponse.status})`);
  return { token, authUserId: decodeSub(token) };
}

async function dataApi(path, token, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return fetch(`${DATA_API}${path}`, { ...init, headers });
}

async function waitForDataApiIdentity(token, expectedId) {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const response = await dataApi("/rpc/current_auth_user_id", token, { method: "POST", body: "{}" });
    const body = await readJson(response);
    const resolved = typeof body === "string" ? body : Array.isArray(body) ? body[0] : body?.current_auth_user_id;
    if (response.ok && resolved === expectedId) return;
    await sleep(500);
  }
  throw new Error("Data API did not recognize ephemeral QA identity");
}

async function controller(action) {
  const response = await fetch(controllerUrl, {
    method: "POST",
    headers: { "content-type": "application/json", "x-crawler-qa-token": controllerToken },
    body: JSON.stringify({ action, marker }),
  });
  const body = await readJson(response);
  assert.equal(response.status, 200, `preview controller ${action} failed (${response.status}): ${JSON.stringify(body)}`);
  return body;
}

async function productionScan(token, profileId, forceNew, pageLimit = 1) {
  const started = Date.now();
  const response = await fetch(`${APP_BASE}/api/website-scan`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ profileId, pageLimit, forceNew }),
  });
  const body = await readJson(response);
  const elapsedMs = Date.now() - started;
  assert.notEqual(response.status, 503, `production crawler returned HTTP 503: ${JSON.stringify(body)}`);
  assert.ok(response.ok, `production crawler HTTP ${response.status}: ${JSON.stringify(body)}`);
  assert.equal(body?.error, undefined, `production crawler error: ${JSON.stringify(body)}`);
  return { body, elapsedMs };
}

const baseline = await controller("state");
assert.equal(baseline.qaUser, 0);
assert.equal(baseline.qaProfiles, 0);

const identity = await signUp();
await waitForDataApiIdentity(identity.token, identity.authUserId);

const profileWrite = await dataApi("/profiles?select=id,name,owner_auth_user_id,website_url,onboarding_completed", identity.token, {
  method: "POST",
  headers: { prefer: "return=representation" },
  body: JSON.stringify({
    name: `Crawler Runtime ${marker}`,
    slug: `crawler-runtime-${marker}`,
    owner_auth_user_id: identity.authUserId,
    website_url: WEBSITE_URL,
    industry: "Property management e affitti brevi",
    onboarding_completed: true,
  }),
});
const profileRows = await readJson(profileWrite);
assert.ok(profileWrite.ok && Array.isArray(profileRows) && profileRows.length === 1, `QA profile creation failed (${profileWrite.status})`);
const profileId = profileRows[0].id;
assert.equal(typeof profileId, "string");

const membershipResponse = await dataApi(`/profile_members?profile_id=eq.${encodeURIComponent(profileId)}&select=profile_id,role`, identity.token);
const memberships = await readJson(membershipResponse);
assert.ok(membershipResponse.ok && Array.isArray(memberships));
assert.deepEqual(memberships.map((row) => row.role), ["OWNER"], "QA profile OWNER membership missing");

const marked = await controller("mark");
assert.equal(marked.qaProfiles, 1);
assert.equal(marked.qaEphemeralProfiles, 1);

const modeResponse = await dataApi(`/profile_tenant_modes?profile_id=eq.${encodeURIComponent(profileId)}&select=tenant_type,external_publishing_enabled`, identity.token);
const modes = await readJson(modeResponse);
assert.ok(modeResponse.ok && Array.isArray(modes) && modes.length === 1);
assert.equal(modes[0].tenant_type, "QA_EPHEMERAL");
assert.equal(modes[0].external_publishing_enabled, false);

const history = [];
let scanId = null;
let previousTerminal = 0;
let complete = null;

for (let batch = 0; batch < 220; batch += 1) {
  if (scanId) {
    const pendingResponse = await dataApi(
      `/website_pages?scan_id=eq.${encodeURIComponent(scanId)}&profile_id=eq.${encodeURIComponent(profileId)}&status=eq.DISCOVERED&select=normalized_url,depth,created_at&order=created_at.asc&limit=8`,
      identity.token,
    );
    const pendingRows = await readJson(pendingResponse);
    assert.ok(pendingResponse.ok && Array.isArray(pendingRows), "pending batch inspection failed");
    console.log("CRAWLER_NEXT_BATCH", JSON.stringify({ batch: batch + 1, urls: pendingRows.map((row) => ({ url: row.normalized_url, depth: row.depth })) }));
  }
  const requestedPageLimit = 1;
  console.log("CRAWLER_REQUEST", JSON.stringify({ batch: batch + 1, pageLimit: requestedPageLimit }));
  const { body, elapsedMs } = await productionScan(identity.token, profileId, batch === 0, requestedPageLimit);
  assert.equal(typeof body.scanId, "string", "scanId missing");
  if (scanId === null) scanId = body.scanId;
  assert.equal(body.scanId, scanId, "continuation switched to a different scan");

  const analyzed = Number(body.analyzedPages || 0);
  const skipped = Number(body.skippedPages || 0);
  const failed = Number(body.failedPages || 0);
  const terminal = analyzed + skipped + failed;
  assert.ok(terminal >= previousTerminal, `scan progress regressed: ${terminal} < ${previousTerminal}`);
  previousTerminal = terminal;

  const scanRowsResponse = await dataApi(`/website_scans?id=eq.${encodeURIComponent(scanId)}&select=id,state,error,discovered_pages,analyzed_pages,skipped_pages,failed_pages`, identity.token);
  const scanRows = await readJson(scanRowsResponse);
  assert.ok(scanRowsResponse.ok && Array.isArray(scanRows) && scanRows.length === 1, "persisted scan checkpoint missing");
  const persisted = scanRows[0];

  if (body.hasMore) {
    assert.equal(body.state, "PARTIAL", "pending batch must remain PARTIAL");
    assert.equal(persisted.error, "BATCH_PENDING", "pending checkpoint must persist BATCH_PENDING");
    assert.notEqual(persisted.state, "FAILED", "pending checkpoint became terminal FAILED");
  }

  history.push({
    batch: batch + 1,
    elapsedMs,
    state: body.state,
    discoveredPages: Number(body.discoveredPages || 0),
    analyzedPages: analyzed,
    skippedPages: skipped,
    failedPages: failed,
    pendingPages: Number(body.pendingPages || 0),
    hasMore: Boolean(body.hasMore),
  });

  console.log("CRAWLER_BATCH", JSON.stringify(history.at(-1)));

  if (!body.hasMore) {
    complete = body;
    break;
  }
}

assert.ok(complete, "crawler did not complete within 220 single-page continuation batches");
assert.ok(history.length >= 2, "runtime did not exercise continuation across multiple batches");
assert.ok(["COMPLETE", "COMPLETE_WITH_WARNINGS"].includes(complete.state), `unexpected final state ${complete.state}`);
assert.ok(Number(complete.analyzedPages || 0) > 0, "crawler analyzed zero pages");

const pagesResponse = await dataApi(`/website_pages?scan_id=eq.${encodeURIComponent(scanId)}&select=normalized_url,status&limit=2000`, identity.token);
const pages = await readJson(pagesResponse);
assert.ok(pagesResponse.ok && Array.isArray(pages), "final website_pages read failed");
assert.equal(new Set(pages.map((row) => row.normalized_url)).size, pages.length, "duplicate normalized_url rows detected");
assert.equal(pages.filter((row) => row.status === "DISCOVERED").length, 0, "final scan still has pending DISCOVERED pages");

const finalScanResponse = await dataApi(`/website_scans?id=eq.${encodeURIComponent(scanId)}&select=state,error,discovered_pages,analyzed_pages,skipped_pages,failed_pages`, identity.token);
const finalRows = await readJson(finalScanResponse);
assert.ok(finalScanResponse.ok && Array.isArray(finalRows) && finalRows.length === 1);
assert.ok(["COMPLETE", "COMPLETE_WITH_WARNINGS"].includes(finalRows[0].state));
assert.notEqual(finalRows[0].error, "BATCH_PENDING");

console.log("WEBSITE_CRAWLER_RUNTIME: PASS", JSON.stringify({
  scanId,
  batches: history.length,
  discoveredPages: Number(complete.discoveredPages || 0),
  analyzedPages: Number(complete.analyzedPages || 0),
  skippedPages: Number(complete.skippedPages || 0),
  failedPages: Number(complete.failedPages || 0),
  finalState: complete.state,
  automaticContinuation: true,
  duplicatePages: 0,
  pendingPages: 0,
  http503: 0,
  cloudflare1102: 0,
}));
