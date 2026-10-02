import assert from "node:assert/strict";
import { chromium } from "playwright";
import { spawn } from "node:child_process";

const base = (process.env.UI_SMOKE_BASE || "http://127.0.0.1:4173").replace(/\/$/, "");

let localServer = null;
async function startLocalServer() {
  if (process.env.UI_SMOKE_START_LOCAL !== "1") return;
  localServer = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", "4173"], {
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    let settled = false;
    let timeout;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      callback(value);
    };
    const onData = (chunk) => {
      const output = String(chunk);
      if (/Local:|ready in/i.test(output)) finish(resolve);
    };
    localServer.stdout?.on("data", onData);
    localServer.stderr?.on("data", onData);
    localServer.once("exit", (code) => finish(reject, new Error("UI_QA_VITE_EXIT_" + code)));
    timeout = setTimeout(() => finish(reject, new Error("UI_QA_VITE_START_TIMEOUT")), 15000);
  });
}

const dataApiHost = "ep-divine-band-arrkz7vq.apirest.c-4.us-west-2.aws.neon.tech";
const profileId = "10000000-0000-4000-8000-000000000001";
const contentId = "10000000-0000-4000-8000-000000000002";
const variantId = "10000000-0000-4000-8000-000000000003";
const jobId = "10000000-0000-4000-8000-000000000004";
const now = new Date();
const future = new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString();
const updatedAt = now.toISOString();

const profile = {
  id: profileId,
  name: "UI QA",
  slug: "ui-qa",
  website_url: "https://example.test",
  industry: "Servizi",
  timezone: "Europe/Rome",
  locale: "it-IT",
  onboarding_completed: true,
  created_at: "2026-10-01T00:00:00.000Z",
  profile_type: "BUSINESS",
  tenant_type: "QA_EPHEMERAL",
  external_publishing_enabled: false,
};

const contentItem = {
  id: contentId,
  profile_id: profileId,
  topic: "Contenuto UI QA",
  objective: "Test responsive",
  title: "Contenuto in revisione",
  status: "IN_REVIEW",
  pillar: "Educazione",
  source_profile_id: null,
  source_profile_ids: [],
  source_refs: [],
  audience: {},
  fact_provenance: [],
  editorial_cta: null,
  source_mix_approved: false,
  decision_record: {},
  created_at: updatedAt,
  updated_at: updatedAt,
};

const variant = {
  id: variantId,
  content_id: contentId,
  profile_id: profileId,
  provider: "FACEBOOK",
  format: "POST",
  eligible: true,
  hook: "Un contenuto leggibile anche da iPhone",
  caption: "Questo testo serve esclusivamente a verificare la leggibilità della schermata Revisioni sui viewport richiesti.",
  cta: "Scopri di più",
  hashtags: ["#uiqa"],
  visual_brief: "Grafica editoriale semplice.",
  image_asset_id: null,
  visual_generation_status: "FAIL",
  visual_generation_error: "OPENAI_IMAGE_HTTP_429_CREDIT_BALANCE_EXHAUSTED",
  visual_generation_operation_id: null,
  visual_generation_started_at: null,
  visual_generation_updated_at: updatedAt,
  alt_text: "Visuale di test",
  approval_status: "PENDING",
  approval_mode: "MANUAL",
  workflow_status: "REVIEW",
  approved_by: null,
  approved_at: null,
  rejected_reason: null,
  approved_fingerprint: null,
  factual_basis: [],
  qa_status: "FAIL",
  qa_fingerprint: null,
  qa_result: { copyStatus: "PASS", visualStatus: "FAIL", reasons: ["Visuale non disponibile"] },
  qa_checked_at: updatedAt,
  created_at: updatedAt,
  updated_at: updatedAt,
};

const calendarJob = {
  id: jobId,
  profile_id: profileId,
  variant_id: variantId,
  provider: "FACEBOOK",
  state: "BLOCKED_APPROVAL",
  scheduled_at: future,
  idempotency_key: "ui-qa-job",
  attempt_count: 0,
  next_attempt_at: null,
  failure_code: null,
  outcome_unknown: false,
  remote_post_id: null,
  published_at: null,
  last_error: null,
  execution_mode: "REAL_EXTERNAL",
  created_at: updatedAt,
  updated_at: updatedAt,
};

const metric = {
  id: "10000000-0000-4000-8000-000000000005",
  provider: "FACEBOOK",
  external_post_id: "fixture-post-read-only",
  format: "POST",
  topic: "Contenuto storico fixture",
  published_at: "2026-09-30T10:00:00.000Z",
  captured_at: "2026-10-01T10:00:00.000Z",
  metrics: { impressions: 120, reach: 85, likes: 7, comments: 0 },
  source: "PROVIDER_API",
  data_origin: "QA_FIXTURE",
};

const providerBase = {
  configured: true,
  configurationIssues: [],
  expiresAt: null,
  lastValidatedAt: updatedAt,
  candidates: [],
  lastError: null,
  capabilities: { publish: ["POST"], note: "Fixture read only" },
};

const socialStatus = {
  providers: [
    { ...providerBase, provider: "FACEBOOK", status: "ACTIVE", accountId: "page-fixture", accountName: "Pagina UI QA", permissions: ["pages_read_engagement"], accountType: "PAGE", readiness: { state: "PASS_REAL", detail: "Collegamento disponibile." } },
    { ...providerBase, provider: "INSTAGRAM", status: "DISCONNECTED", accountId: null, accountName: null, permissions: [], accountType: null, readiness: { state: "USER_ACTION_REQUIRED", detail: "Collega un account Instagram." } },
    { ...providerBase, provider: "LINKEDIN", status: "DISCONNECTED", accountId: null, accountName: null, permissions: [], accountType: null, readiness: { state: "USER_ACTION_REQUIRED", detail: "Collega un account LinkedIn." } },
    { ...providerBase, provider: "GBP", configured: false, configurationIssues: ["Configurazione non completata"], status: "NOT_CONNECTED", accountId: null, accountName: null, permissions: [], accountType: null, readiness: { state: "BLOCKED_PROVIDER", detail: "Provider da configurare." } },
  ],
};

function cors(origin) {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "GET,HEAD,OPTIONS",
    "access-control-expose-headers": "content-range,content-location",
    "content-type": "application/json; charset=utf-8",
  };
}

function rowsForTable(table, url) {
  if (table === "content_items") return [contentItem];
  if (table === "content_variants") return [variant];
  if (table === "publication_jobs") return [calendarJob];
  if (table === "metric_snapshots") return [metric];
  if (table === "learning_insights") return [];
  if (table === "social_connections") return [{ id: "10000000-0000-4000-8000-000000000006", profile_id: profileId, status: "ACTIVE" }];
  if (table === "content_strategies") return [{ platform_strategy: {} }];
  if (table === "content_carousel_slides" || table === "assets" || table === "schedules") return [];
  if (table === "profile_entitlements" || table === "capability_usage_buckets") return [];
  if (table === "brand_profiles" || table === "website_scans" || table === "website_scan_pages") return [];
  return [];
}

async function installFixtureRoutes(page, { authenticated = true, socialFailure = false } = {}) {
  const blockedWrites = [];
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method().toUpperCase();

    if (url.hostname === dataApiHost) {
      if (method === "OPTIONS") {
        await route.fulfill({ status: 204, headers: cors(base) });
        return;
      }
      if (!["GET", "HEAD"].includes(method)) {
        blockedWrites.push(method + " " + url.pathname);
        await route.fulfill({ status: 418, headers: cors(base), body: JSON.stringify({ error: "UI_QA_EXTERNAL_WRITE_BLOCKED" }) });
        return;
      }
      const table = url.pathname.split("/").filter(Boolean).at(-1) || "";
      const rows = rowsForTable(table, url);
      const headers = { ...cors(base), "content-range": rows.length ? "0-" + (rows.length - 1) + "/" + rows.length : "*/0" };
      await route.fulfill(method === "HEAD"
        ? { status: 200, headers }
        : { status: 200, headers, body: JSON.stringify(rows) });
      return;
    }

    if (url.origin === base && url.pathname.startsWith("/api/auth/")) {
      if (url.pathname.endsWith("/get-session")) {
        await route.fulfill({
          status: 200,
          headers: { "content-type": "application/json", "cache-control": "no-store" },
          body: JSON.stringify(authenticated ? {
            session: { id: "ui-qa-session", token: "fixture-session-token", userId: "ui-qa-user", expiresAt: "2099-01-01T00:00:00.000Z" },
            user: { id: "ui-qa-user", name: "UI QA", email: "ui-qa@example.invalid" },
          } : null),
        });
        return;
      }
      if (url.pathname.endsWith("/token")) {
        await route.fulfill({ status: authenticated ? 200 : 401, headers: { "content-type": "application/json" }, body: JSON.stringify(authenticated ? { token: "fixture-session-token" } : { error: "AUTH_REQUIRED" }) });
        return;
      }
      if (!["GET", "HEAD"].includes(method)) {
        blockedWrites.push(method + " " + url.pathname);
        await route.fulfill({ status: 418, headers: { "content-type": "application/json" }, body: JSON.stringify({ error: "UI_QA_AUTH_WRITE_BLOCKED" }) });
        return;
      }
    }

    if (url.origin === base && url.pathname === "/api/profile-bootstrap") {
      if (method !== "GET") blockedWrites.push(method + " " + url.pathname);
      await route.fulfill({ status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ profiles: [profile] }) });
      return;
    }

    if (url.origin === base && url.pathname === "/api/social/status") {
      if (method !== "GET") blockedWrites.push(method + " " + url.pathname);
      await route.fulfill({
        status: socialFailure ? 500 : 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(socialFailure ? { error: "SOCIAL_STATUS_FAILED" } : socialStatus),
      });
      return;
    }

    if (url.origin === base && process.env.UI_SMOKE_START_LOCAL === "1" && url.pathname.startsWith("/api/_lib/") && ["GET", "HEAD"].includes(method)) {
      await route.continue();
      return;
    }

    if (url.origin === base && url.pathname.startsWith("/api/")) {
      if (!["GET", "HEAD"].includes(method)) blockedWrites.push(method + " " + url.pathname);
      await route.fulfill({
        status: 418,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ error: "UI_QA_UNEXPECTED_API_CALL" }),
      });
      return;
    }

    await route.continue();
  });
  return blockedWrites;
}

async function layout(page) {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    innerWidth: window.innerWidth,
  }));
}

async function assertNoDocumentOverflow(page, label) {
  const value = await layout(page);
  assert.ok(value.scrollWidth <= value.clientWidth + 2, label + " document overflow " + value.scrollWidth + " > " + value.clientWidth);
}

async function open(page, path, heading) {
  const response = await page.goto(base + path, { waitUntil: "domcontentloaded", timeout: 30000 });
  assert.ok(response && response.status() < 500, path + " document unavailable");
  try {
    await page.getByRole("heading", { name: heading, exact: true }).waitFor({ state: "visible", timeout: 15000 });
  } catch (reason) {
    const body = (await page.locator("body").innerText().catch(() => "")).slice(0, 1200);
    throw new Error("UI_QA_HEADING_TIMEOUT " + path + " -> " + heading + " | body=" + JSON.stringify(body) + " | cause=" + (reason instanceof Error ? reason.message : String(reason)));
  }
}

async function verifyAuthenticatedViewport(browser, viewport, label) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const blockedWrites = await installFixtureRoutes(page);
  const critical = [];
  page.on("pageerror", (error) => critical.push("pageerror:" + error.message));
  page.on("console", (message) => { if (message.type() === "error") critical.push("console:" + message.text()); });

  try {
    await open(page, "/app/dashboard", "Cosa richiede attenzione oggi");
    await assertNoDocumentOverflow(page, label + " dashboard");

    const desktop = viewport.width > 760;
    assert.equal(await page.locator(".sidebar").isVisible(), desktop, label + " sidebar visibility");
    assert.equal(await page.locator(".mobile-nav").isVisible(), !desktop, label + " mobile nav visibility");

    const hrefs = await page.locator(desktop ? ".sidebar a.nav-link" : ".mobile-nav a.mobile-nav-link").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href")));
    for (const required of ["/app/dashboard","/app/contenuti","/app/calendario","/app/social"]) {
      assert.ok(hrefs.includes(required), label + " navigation missing " + required);
    }

    if (!desktop) {
      const more = page.getByRole("button", { name: "Apri altre sezioni" });
      const box = await more.boundingBox();
      assert.ok(box && box.height >= 44, label + " Altro touch target below 44px");
      await more.click();
      const dialog = page.getByRole("dialog", { name: "Altre sezioni" });
      await dialog.waitFor({ state: "visible" });
      for (const name of ["Attività","Brand","Sito","Revisioni","Libreria","Analytics","Apprendimento","Impostazioni"]) {
        await dialog.getByRole("link", { name, exact: true }).waitFor({ state: "visible" });
      }
      await page.getByRole("button", { name: "Chiudi menu" }).click();
      await dialog.waitFor({ state: "hidden" });
    }

    await open(page, "/app/approvazioni", "Revisione contenuti");
    await page.getByText("Facebook", { exact: true }).first().waitFor({ state: "visible" });
    await page.getByText("POST", { exact: true }).first().waitFor({ state: "visible" });
    await page.getByText("In revisione · Manuale", { exact: true }).waitFor({ state: "visible" });
    const approvalBody = await page.locator("body").innerText();
    assert.ok(approvalBody.includes("credito o la fatturazione OpenAI non sono disponibili"), label + " blocked billing explanation missing");
    assert.equal(approvalBody.includes("OPENAI_IMAGE_HTTP_429_CREDIT_BALANCE_EXHAUSTED"), false, label + " raw provider error exposed");
    assert.equal(await page.getByRole("button", { name: "Approva", exact: true }).isDisabled(), true, label + " approval should be disabled while QA FAIL");
    await assertNoDocumentOverflow(page, label + " approvals");

    await open(page, "/app/calendario", "Calendario contenuti");
    await page.getByRole("button", { name: "Settimana", exact: true }).click();
    const weekScroll = page.locator(".calendar-week-scroll");
    await weekScroll.waitFor({ state: "visible" });
    const weekLayout = await weekScroll.evaluate((node) => {
      const style = getComputedStyle(node);
      return { clientWidth: node.clientWidth, scrollWidth: node.scrollWidth, overflowX: style.overflowX };
    });
    assert.equal(weekLayout.overflowX, "auto", label + " week viewport is not scrollable");
    if (!desktop) assert.ok(weekLayout.scrollWidth > weekLayout.clientWidth, label + " week content does not expose contained horizontal scroll");
    await assertNoDocumentOverflow(page, label + " calendar week");

    await open(page, "/app/social", "Collegamenti social");
    await page.getByText("Pagina UI QA", { exact: true }).waitFor({ state: "visible" });
    await assertNoDocumentOverflow(page, label + " social");

    await open(page, "/app/analytics", "Risultati dei tuoi social");
    await page.getByText("120", { exact: true }).waitFor({ state: "visible" });
    await page.getByText("0", { exact: true }).waitFor({ state: "visible" });
    await assertNoDocumentOverflow(page, label + " analytics");

    await open(page, "/app/profili", "Le tue attività");
    await page.locator(".profile-card h2", { hasText: "UI QA" }).waitFor({ state: "visible" });
    await assertNoDocumentOverflow(page, label + " profiles");

    const rendered = await page.locator("body").innerText();
    for (const forbidden of ["fixture-session-token","DATABASE_URL","SOCIAL_TOKEN_KEY","OPENAI_API_KEY","postgresql://"]) {
      assert.equal(rendered.includes(forbidden), false, label + " rendered secret pattern " + forbidden);
    }
    assert.deepEqual(blockedWrites, [], label + " unexpected write attempts: " + JSON.stringify(blockedWrites));
    assert.deepEqual(critical, [], label + " critical browser errors: " + JSON.stringify(critical));
    console.log("UI_VIEWPORT_PASS", JSON.stringify({ label, viewport, blockedWrites: 0 }));
  } finally {
    await context.close();
  }
}

async function verifySocialErrorState(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const blockedWrites = await installFixtureRoutes(page, { socialFailure: true });
  try {
    await page.goto(base + "/app/social", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.getByRole("heading", { name: "Stato social non disponibile", exact: true }).waitFor({ state: "visible", timeout: 10000 });
    await page.getByRole("button", { name: "Riprova", exact: true }).waitFor({ state: "visible" });
    assert.deepEqual(blockedWrites, []);
    console.log("UI_ERROR_STATE_RUNTIME = PASS");
  } finally {
    await context.close();
  }
}

async function verifyLoginValidation(browser) {
  const context = await browser.newContext({ viewport: { width: 360, height: 800 } });
  const page = await context.newPage();
  const blockedWrites = await installFixtureRoutes(page, { authenticated: false });
  try {
    await page.goto(base + "/login", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.getByRole("heading", { name: "Bentornato", exact: true }).waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Accedi", exact: true }).click();
    assert.equal(new URL(page.url()).pathname, "/login");
    assert.equal(await page.locator('input[type="email"]').evaluate((input) => input.matches(":invalid")), true);
    assert.deepEqual(blockedWrites, [], "native form validation triggered a network write");
    await assertNoDocumentOverflow(page, "360x800 login");
    console.log("UI_FORM_VALIDATION_RUNTIME = PASS");
  } finally {
    await context.close();
  }
}

await startLocalServer();

const browser = await chromium.launch({ headless: true });
try {
  for (const item of [
    { viewport: { width: 1440, height: 900 }, label: "1440x900" },
    { viewport: { width: 1280, height: 720 }, label: "1280x720" },
    { viewport: { width: 390, height: 844 }, label: "390x844" },
    { viewport: { width: 360, height: 800 }, label: "360x800" },
  ]) await verifyAuthenticatedViewport(browser, item.viewport, item.label);
  await verifySocialErrorState(browser);
  await verifyLoginValidation(browser);
  console.log("MOBILE_DESKTOP_UI_BROWSER_QA = PASS");
} finally {
  await browser.close();
  if (localServer && !localServer.killed) localServer.kill("SIGTERM");
}
