import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { snapshotsToPerformanceSamples } from "../api/_lib/feedback-loop.js";
import { scorePerformanceSample } from "../api/_lib/learning-engine.js";

export const PHASE_STATUSES = [
  "PASS", "FAIL_PRODUCT", "FAIL_CONFIGURATION", "BLOCKED_EXTERNAL",
  "WAITING_MANUAL_ACTION", "WAITING_REAL_DATA", "NOT_RUN",
];
export const EXTERNAL_STATUSES = ["PASS", "BLOCKED_EXTERNAL_VERIFIED", "NOT_RUN"];

export const REQUIRED_CHECKS = [
  "AUTH_EMAIL_PASSWORD", "AUTH_GOOGLE", "PASSWORD_RECOVERY", "SESSION",
  "DEMO_ACCOUNT", "DEMO_DESKTOP", "DEMO_MOBILE", "DEMO_ISOLATION", "DEMO_PUBLISH_GUARD",
  "BRAND", "WEBSITE", "TEXT_GENERATION", "IMAGE_GENERATION", "REVIEW", "CALENDAR", "AUTOPILOT",
  "FACEBOOK_PUBLISH", "FACEBOOK_ANALYTICS", "INSTAGRAM_PUBLISH", "INSTAGRAM_ANALYTICS",
  "LEARNING_RUNTIME", "TENANT_ISOLATION", "SENSITIVE_FINDINGS", "P0_P1_OPEN",
];

export const PHASES = [
  { id: "01", key: "AUTH_READINESS", mode: "automatic", checks: [] },
  { id: "02", key: "EMAIL_PASSWORD", mode: "automatic", checks: ["AUTH_EMAIL_PASSWORD", "SESSION"] },
  { id: "03", key: "GOOGLE_LOGIN", mode: "manual-resume", checks: ["AUTH_GOOGLE", "SESSION"] },
  { id: "04", key: "PASSWORD_RECOVERY", mode: "manual-resume", checks: ["PASSWORD_RECOVERY"] },
  { id: "05", key: "DEMO_PROVISIONING", mode: "automatic", checks: ["DEMO_ACCOUNT", "DEMO_ISOLATION", "DEMO_PUBLISH_GUARD"] },
  { id: "06", key: "DEMO_SEED", mode: "automatic", checks: ["BRAND", "WEBSITE"] },
  { id: "07", key: "DEMO_DESKTOP", mode: "verifier-170", checks: ["DEMO_DESKTOP", "TEXT_GENERATION", "IMAGE_GENERATION", "REVIEW", "CALENDAR", "AUTOPILOT"] },
  { id: "08", key: "DEMO_MOBILE", mode: "verifier-170", checks: ["DEMO_MOBILE"] },
  { id: "09", key: "GBP", mode: "manual-resume", checks: [] },
  { id: "10", key: "FACEBOOK", mode: "hybrid", checks: ["FACEBOOK_PUBLISH", "FACEBOOK_ANALYTICS"] },
  { id: "11", key: "INSTAGRAM", mode: "hybrid", checks: ["INSTAGRAM_PUBLISH", "INSTAGRAM_ANALYTICS"] },
  { id: "12", key: "CONTENT", mode: "verifier-170", checks: ["TEXT_GENERATION", "IMAGE_GENERATION", "REVIEW", "CALENDAR"] },
  { id: "13", key: "AUTOPILOT", mode: "verifier-170", checks: ["AUTOPILOT"] },
  { id: "14", key: "LEARNING", mode: "automatic", checks: ["LEARNING_RUNTIME"] },
  { id: "15", key: "SECURITY_CLEANUP", mode: "verifier-170", checks: ["TENANT_ISOLATION", "SENSITIVE_FINDINGS", "P0_P1_OPEN"] },
];

const DEFAULT_APP_BASE = "https://autoposter.02alessandrocaruso.workers.dev";
const DEFAULT_STATE = ".qa/final-personal-readiness.json";
const SECRET_PATTERN = /(authorization\s*:|bearer\s+[a-z0-9._-]{12,}|password\s*[=:]|cookie\s*[=:]|session[_ -]?secret|api[_ -]?key|sk-[a-z0-9_-]{12,})/i;

function flagValues(args, name) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) if (args[index] === name && args[index + 1]) values.push(args[index + 1]);
  return values;
}

function flag(args, name, fallback = null) {
  return flagValues(args, name).at(-1) ?? fallback;
}

function ensureStatus(value) {
  if (!PHASE_STATUSES.includes(value)) throw new Error(`INVALID_STATUS:${value}`);
  return value;
}

function safeEvidence(value) {
  const text = String(value ?? "").trim();
  if (text.length > 1200) throw new Error("EVIDENCE_TOO_LONG");
  if (SECRET_PATTERN.test(text)) throw new Error("SENSITIVE_EVIDENCE_REJECTED");
  return text;
}

function rejectSecrets(value) {
  const text = JSON.stringify(value);
  if (SECRET_PATTERN.test(text)) throw new Error("SENSITIVE_EVIDENCE_REJECTED");
}

export function createInitialState(candidateSha = "") {
  return {
    schemaVersion: 1,
    candidateSha,
    updatedAt: new Date().toISOString(),
    phases: Object.fromEntries(PHASES.map((phase) => [phase.id, { key: phase.key, status: "NOT_RUN", evidence: "", instruction: "" }])),
    checks: Object.fromEntries(REQUIRED_CHECKS.map((check) => [check, { status: "NOT_RUN", evidence: "" }])),
    external: {
      GBP: { status: "NOT_RUN", evidence: "" },
      LINKEDIN_ANALYTICS: { status: "BLOCKED_EXTERNAL_VERIFIED", evidence: "Provider limitation accepted; outside personal-product completion." },
    },
    counters: { sensitiveFindings: null, p0P1Open: null, validRealSamples: null, missingRealSamples: null },
    context: { demoProfileId: null },
  };
}

export function computeCompletion(state) {
  const completed = REQUIRED_CHECKS.filter((key) => state.checks?.[key]?.status === "PASS").length;
  const productBugs = Object.values(state.phases ?? {}).filter((phase) => phase.status === "FAIL_PRODUCT").length
    + Object.values(state.checks ?? {}).filter((check) => check.status === "FAIL_PRODUCT").length;
  const externalReady = ["GBP", "LINKEDIN_ANALYTICS"].every((key) => ["PASS", "BLOCKED_EXTERNAL_VERIFIED"].includes(state.external?.[key]?.status));
  return {
    completed,
    required: REQUIRED_CHECKS.length,
    ready: completed === REQUIRED_CHECKS.length && productBugs === 0 && externalReady,
    productBugs,
    externalReady,
  };
}

export function countValidRealSamples(profileId, rows) {
  const real = rows.filter((row) => row.source === "PROVIDER_API")
    .filter((row) => row.provider === "FACEBOOK" || row.provider === "INSTAGRAM")
    .filter((row) => typeof row.external_post_id === "string" && row.external_post_id.trim())
    .filter((row) => typeof row.format === "string" && row.format.trim())
    .filter((row) => typeof row.topic === "string" && row.topic.trim())
    .filter((row) => typeof row.published_at === "string" && typeof row.captured_at === "string");
  const samples = snapshotsToPerformanceSamples(profileId, real);
  return samples.filter((sample) => scorePerformanceSample(sample) !== null).length;
}

async function loadState(statePath) {
  return JSON.parse(await fs.readFile(statePath, "utf8"));
}

async function saveState(statePath, state) {
  state.updatedAt = new Date().toISOString();
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  const temporary = `${statePath}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporary, statePath);
}

function setCheck(state, key, status, evidence = "") {
  if (!REQUIRED_CHECKS.includes(key)) throw new Error(`UNKNOWN_CHECK:${key}`);
  state.checks[key] = { status: ensureStatus(status), evidence: safeEvidence(evidence) };
}

function setPhase(state, phaseId, result) {
  const phase = PHASES.find((item) => item.id === phaseId);
  if (!phase) throw new Error(`UNKNOWN_PHASE:${phaseId}`);
  const status = ensureStatus(result.status);
  state.phases[phaseId] = {
    key: phase.key,
    status,
    evidence: safeEvidence(result.evidence),
    instruction: status === "WAITING_MANUAL_ACTION" ? safeEvidence(result.instruction) : "",
  };
  for (const [key, value] of Object.entries(result.checks ?? {})) setCheck(state, key, value.status, value.evidence ?? result.evidence);
  if (result.context) state.context = { ...state.context, ...result.context };
  if (result.counters) state.counters = { ...state.counters, ...result.counters };
}

function report(state) {
  const completion = computeCompletion(state);
  const waiting = PHASES.filter((phase) => state.phases[phase.id]?.status !== "PASS").map((phase) => ({ id: phase.id, key: phase.key, status: state.phases[phase.id]?.status ?? "NOT_RUN" }));
  return {
    candidateSha: state.candidateSha,
    completedRequiredChecks: `${completion.completed}/${completion.required}`,
    ready: completion.ready,
    productBugs: completion.productBugs,
    external: state.external,
    counters: state.counters,
    waiting,
  };
}

function cookieHeader(response, jar) {
  const values = response.headers.getSetCookie?.() ?? [];
  for (const value of values) {
    const pair = value.split(";", 1)[0];
    const separator = pair.indexOf("=");
    if (separator > 0) jar.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
  return [...jar].map(([key, value]) => `${key}=${value}`).join("; ");
}

async function jsonResponse(response) {
  const text = await response.text();
  try { return text ? JSON.parse(text) : {}; } catch { return {}; }
}

async function authIdentity(email, password, allowCreate = false) {
  if (!email || !password) throw new Error("AUTH_CREDENTIAL_ENV_REQUIRED");
  const base = process.env.FINAL_QA_APP_BASE || DEFAULT_APP_BASE;
  const jar = new Map();
  const call = async (route, body) => {
    const response = await fetch(`${base}/api/auth/${route}`, {
      method: body ? "POST" : "GET",
      headers: { accept: "application/json", origin: base, referer: `${base}/`, ...(body ? { "content-type": "application/json" } : {}), ...(jar.size ? { cookie: [...jar].map(([key, value]) => `${key}=${value}`).join("; ") } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      redirect: "manual",
    });
    cookieHeader(response, jar);
    return { response, body: await jsonResponse(response) };
  };
  let signed = await call("sign-in/email", { email, password });
  if (!signed.response.ok && allowCreate) signed = await call("sign-up/email", { email, password, name: "Demo Post Automatici" });
  if (!signed.response.ok) throw new Error(`AUTH_EMAIL_HTTP_${signed.response.status}`);
  const session = await call("get-session");
  if (!session.response.ok || !session.body?.user?.id) throw new Error("AUTH_SESSION_MISSING");
  const token = await call("token");
  const bearer = token.body?.token || token.body?.data?.token;
  if (!token.response.ok || typeof bearer !== "string" || bearer.length < 40) throw new Error("AUTH_BEARER_MISSING");
  return { userId: String(session.body.user.id), bearer };
}

async function dataRows(resource, bearer) {
  const base = process.env.FINAL_QA_DATA_API;
  if (!base) throw new Error("FINAL_QA_DATA_API_REQUIRED");
  const response = await fetch(`${base.replace(/\/$/, "")}/${resource}`, { headers: { authorization: `Bearer ${bearer}`, accept: "application/json" } });
  const body = await jsonResponse(response);
  if (!response.ok || !Array.isArray(body)) throw new Error(`DATA_API_HTTP_${response.status}`);
  return body;
}

async function automaticPhase(phase, state) {
  const appBase = process.env.FINAL_QA_APP_BASE || DEFAULT_APP_BASE;
  if (phase.id === "01") {
    const response = await fetch(`${appBase}/api/auth/get-session`, { headers: { accept: "application/json" } });
    if (response.status === 402 || response.status >= 500) return { status: "BLOCKED_EXTERNAL", evidence: `Managed Auth HTTP ${response.status}` };
    if (response.status !== 200) return { status: "FAIL_CONFIGURATION", evidence: `Managed Auth readiness HTTP ${response.status}` };
    return { status: "PASS", evidence: "Managed Auth same-origin readiness HTTP 200." };
  }
  if (phase.id === "02") {
    await authIdentity(process.env.FINAL_QA_USER_EMAIL, process.env.FINAL_QA_USER_PASSWORD, false);
    return { status: "PASS", evidence: "Email/password login, authenticated session and bearer resolution succeeded.", checks: { AUTH_EMAIL_PASSWORD: { status: "PASS" }, SESSION: { status: "PASS" } } };
  }
  if (phase.id === "05") {
    const identity = await authIdentity(process.env.FINAL_QA_DEMO_EMAIL, process.env.FINAL_QA_DEMO_PASSWORD, process.env.FINAL_QA_ALLOW_CREATE_DEMO === "true");
    const adminBearer = process.env.FINAL_QA_ADMIN_BEARER;
    if (!adminBearer) throw new Error("FINAL_QA_ADMIN_BEARER_REQUIRED");
    const response = await fetch(`${appBase}/api/admin/demo/provision`, { method: "POST", headers: { authorization: `Bearer ${adminBearer}`, "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ ownerAuthUserId: identity.userId }) });
    const body = await jsonResponse(response);
    if (!response.ok || body?.tenantType !== "DEMO_PERSISTENT" || !body?.profileId) return { status: response.status >= 500 ? "FAIL_PRODUCT" : "FAIL_CONFIGURATION", evidence: `Demo provisioning HTTP ${response.status}` };
    return { status: "PASS", evidence: "Demo user resolved and DEMO_PERSISTENT provisioned idempotently.", context: { demoProfileId: body.profileId }, checks: { DEMO_ACCOUNT: { status: "PASS" } } };
  }
  if (phase.id === "06") {
    const profileId = state.context.demoProfileId;
    if (!profileId) return { status: "FAIL_CONFIGURATION", evidence: "Demo profile checkpoint missing." };
    const identity = await authIdentity(process.env.FINAL_QA_DEMO_EMAIL, process.env.FINAL_QA_DEMO_PASSWORD, false);
    const [mode, entitlements, brand, scans, content, metrics, insights, connections, jobs] = await Promise.all([
      dataRows(`profile_tenant_modes?profile_id=eq.${encodeURIComponent(profileId)}&select=tenant_type,external_publishing_enabled`, identity.bearer),
      dataRows(`profile_entitlements?profile_id=eq.${encodeURIComponent(profileId)}&select=capability_key,enabled,source`, identity.bearer),
      dataRows(`brand_profiles?profile_id=eq.${encodeURIComponent(profileId)}&select=profile_id`, identity.bearer),
      dataRows(`website_scans?profile_id=eq.${encodeURIComponent(profileId)}&data_origin=eq.DEMO_SAMPLE&select=id`, identity.bearer),
      dataRows(`content_items?profile_id=eq.${encodeURIComponent(profileId)}&data_origin=eq.DEMO_SAMPLE&select=id,status`, identity.bearer),
      dataRows(`metric_snapshots?profile_id=eq.${encodeURIComponent(profileId)}&source=eq.DEMO_SAMPLE&select=id`, identity.bearer),
      dataRows(`learning_insights?profile_id=eq.${encodeURIComponent(profileId)}&source_type=eq.DEMO_SAMPLE&select=id`, identity.bearer),
      dataRows(`social_connections?profile_id=eq.${encodeURIComponent(profileId)}&select=id`, identity.bearer),
      dataRows(`publication_jobs?profile_id=eq.${encodeURIComponent(profileId)}&select=id,execution_mode,remote_post_id`, identity.bearer),
    ]);
    const statuses = new Set(content.map((row) => row.status));
    const entitlement = new Map(entitlements.map((row) => [row.capability_key, row]));
    const enabledCapabilities = ["ai.content.generate_text", "ai.image.generate", "autopilot.manage"];
    const disabledPublishing = ["social.publish.scheduled", "social.facebook.publish", "social.instagram.publish"];
    const safe = mode.length === 1 && mode[0].tenant_type === "DEMO_PERSISTENT" && mode[0].external_publishing_enabled === false
      && enabledCapabilities.every((key) => entitlement.get(key)?.enabled === true && entitlement.get(key)?.source === "PACKAGE:demo_persistent:v1")
      && disabledPublishing.every((key) => entitlement.get(key)?.enabled === false && entitlement.get(key)?.source === "PACKAGE:demo_persistent:v1")
      && brand.length === 1 && scans.length >= 1 && ["DRAFT", "IN_REVIEW", "APPROVED"].every((value) => statuses.has(value))
      && metrics.length >= 2 && insights.length >= 2 && connections.length === 0
      && jobs.length >= 2 && jobs.every((job) => job.execution_mode === "DEMO_SIMULATION" && job.remote_post_id === null);
    if (!safe) return { status: "FAIL_PRODUCT", evidence: "Demo seed or external-publication invariant mismatch." };
    return { status: "PASS", evidence: "Demo seed, entitlement package, isolation and publication guard verified.", checks: { BRAND: { status: "PASS" }, WEBSITE: { status: "PASS" }, DEMO_ISOLATION: { status: "PASS" }, DEMO_PUBLISH_GUARD: { status: "PASS" } } };
  }
  if (phase.id === "14") {
    const profileId = process.env.FINAL_QA_PROFILE_ID;
    if (!profileId) return { status: "FAIL_CONFIGURATION", evidence: "FINAL_QA_PROFILE_ID is required." };
    const identity = await authIdentity(process.env.FINAL_QA_USER_EMAIL, process.env.FINAL_QA_USER_PASSWORD, false);
    const rows = await dataRows(`metric_snapshots?profile_id=eq.${encodeURIComponent(profileId)}&source=eq.PROVIDER_API&provider=in.(FACEBOOK,INSTAGRAM)&external_post_id=not.is.null&published_at=not.is.null&captured_at=not.is.null&format=not.is.null&topic=not.is.null&select=profile_id,provider,external_post_id,format,topic,published_at,captured_at,metrics,source&order=captured_at.desc&limit=1000`, identity.bearer);
    const valid = countValidRealSamples(profileId, rows);
    const missing = Math.max(10 - valid, 0);
    if (valid < 10) return { status: "WAITING_REAL_DATA", evidence: `VALID_REAL_SAMPLES=${valid}/10; MISSING=${missing}`, counters: { validRealSamples: valid, missingRealSamples: missing } };
    const response = await fetch(`${appBase}/api/learning/run`, { method: "POST", headers: { authorization: `Bearer ${identity.bearer}`, "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ profileId }) });
    const body = await jsonResponse(response);
    if (!response.ok || body?.ready !== true) return { status: "FAIL_PRODUCT", evidence: `Learning runtime HTTP ${response.status}.` };
    return { status: "PASS", evidence: `VALID_REAL_SAMPLES=${valid}/10; learning runtime ready.`, counters: { validRealSamples: valid, missingRealSamples: 0 }, checks: { LEARNING_RUNTIME: { status: "PASS" } } };
  }
  return null;
}

function waitingResult(phase, state) {
  if (phase.id === "03") return { status: "WAITING_MANUAL_ACTION", evidence: "Google Login requires real account consent.", instruction: `Apri ${process.env.FINAL_QA_APP_BASE || DEFAULT_APP_BASE}/login, seleziona Accedi con Google e completa il consenso; poi registra AUTH_GOOGLE=PASS e riprendi.` };
  if (phase.id === "04") return { status: "WAITING_MANUAL_ACTION", evidence: "Password recovery requires proof of real email delivery.", instruction: "Richiedi il recupero password, apri l’email reale, cambia password, verifica login e riuso token negato; poi registra PASSWORD_RECOVERY=PASS e riprendi." };
  if (phase.id === "09") return { status: "WAITING_MANUAL_ACTION", evidence: "GBP OAuth is separate from Google Login.", instruction: `Apri ${process.env.FINAL_QA_APP_BASE || DEFAULT_APP_BASE}/app/social, collega Google Business Profile e completa un solo consenso; poi registra GBP=PASS o BLOCKED_EXTERNAL_VERIFIED.` };
  if (["07", "08", "12", "13", "15"].includes(phase.id)) {
    const missing = phase.checks.filter((check) => state.checks[check]?.status !== "PASS");
    if (!missing.length) return { status: "PASS", evidence: "Imported verifier #170 evidence satisfies this phase." };
    return { status: "WAITING_MANUAL_ACTION", evidence: `Verifier #170 evidence missing for: ${missing.join(", ")}.`, instruction: "Esegui una sola volta il verifier #170 sul deployment candidato, importa il report JSON e riprendi questo runner." };
  }
  if (["10", "11"].includes(phase.id)) return { status: "WAITING_MANUAL_ACTION", evidence: `${phase.key} requires existing real connection evidence; no test post was published.`, instruction: `Verifica connessione, Analytics e una pubblicazione reale appropriata per ${phase.key}; importa soltanto l’esito, senza token o contenuti sensibili, quindi riprendi.` };
  return { status: "FAIL_CONFIGURATION", evidence: `No adapter configured for phase ${phase.id}.` };
}

async function run(statePath, state, startId = null) {
  let started = startId === null;
  for (const phase of PHASES) {
    if (!started && phase.id === startId) started = true;
    if (!started || state.phases[phase.id]?.status === "PASS") continue;
    let result;
    try { result = await automaticPhase(phase, state) ?? waitingResult(phase, state); }
    catch (reason) {
      const code = reason instanceof Error ? reason.message : "UNKNOWN_RUNNER_ERROR";
      result = { status: /_REQUIRED$/.test(code) ? "FAIL_CONFIGURATION" : /^AUTH_EMAIL_HTTP_(402|5\d\d)$/.test(code) ? "BLOCKED_EXTERNAL" : "FAIL_PRODUCT", evidence: code };
    }
    setPhase(state, phase.id, result);
    await saveState(statePath, state);
    console.log(JSON.stringify({ phase: phase.id, key: phase.key, status: result.status, evidence: result.evidence, instruction: result.instruction || undefined }));
    if (result.status === "FAIL_PRODUCT" || result.status === "WAITING_MANUAL_ACTION" || result.status === "FAIL_CONFIGURATION") break;
  }
  console.log(JSON.stringify(report(state), null, 2));
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "plan";
  const statePath = path.resolve(flag(args, "--state", process.env.FINAL_QA_STATE || DEFAULT_STATE));
  if (command === "generate-password") {
    if (process.env.GITHUB_ACTIONS === "true") throw new Error("PASSWORD_GENERATION_INTERACTIVE_ONLY");
    console.log(randomBytes(24).toString("base64url"));
    return;
  }
  if (command === "plan") { console.log(JSON.stringify({ statuses: PHASE_STATUSES, phases: PHASES, requiredChecks: REQUIRED_CHECKS }, null, 2)); return; }
  if (command === "init") {
    const state = createInitialState(flag(args, "--candidate-sha", ""));
    await saveState(statePath, state);
    console.log(JSON.stringify(report(state), null, 2));
    return;
  }
  const state = await loadState(statePath);
  if (command === "baseline") {
    const evidence = flag(args, "--evidence");
    if (!evidence) throw new Error("BASELINE_EVIDENCE_REQUIRED");
    setCheck(state, "TENANT_ISOLATION", "PASS", evidence);
    setCheck(state, "SENSITIVE_FINDINGS", "PASS", evidence);
    setCheck(state, "P0_P1_OPEN", "PASS", evidence);
    state.counters.sensitiveFindings = 0; state.counters.p0P1Open = 0;
    await saveState(statePath, state); console.log(JSON.stringify(report(state), null, 2)); return;
  }
  if (command === "record") {
    const phaseId = flag(args, "--phase");
    const status = ensureStatus(flag(args, "--status"));
    const evidence = flag(args, "--evidence", "");
    const instruction = flag(args, "--instruction", "");
    if (phaseId) setPhase(state, phaseId, { status, evidence, instruction });
    for (const value of flagValues(args, "--check")) {
      const [key, checkStatus] = value.split("="); setCheck(state, key, ensureStatus(checkStatus), evidence);
    }
    await saveState(statePath, state); console.log(JSON.stringify(report(state), null, 2)); return;
  }
  if (command === "record-external") {
    const key = flag(args, "--key"); const status = flag(args, "--status"); const evidence = safeEvidence(flag(args, "--evidence", ""));
    if (!["GBP", "LINKEDIN_ANALYTICS"].includes(key) || !EXTERNAL_STATUSES.includes(status)) throw new Error("INVALID_EXTERNAL_RESULT");
    state.external[key] = { status, evidence }; await saveState(statePath, state); console.log(JSON.stringify(report(state), null, 2)); return;
  }
  if (command === "import") {
    const file = flag(args, "--file"); if (!file) throw new Error("REPORT_FILE_REQUIRED");
    const imported = JSON.parse(await fs.readFile(file, "utf8"));
    rejectSecrets(imported);
    for (const [key, value] of Object.entries(imported.checks ?? {})) setCheck(state, key, value.status, value.evidence ?? imported.evidence ?? "Imported verifier evidence.");
    await saveState(statePath, state); console.log(JSON.stringify(report(state), null, 2)); return;
  }
  if (command === "report") { console.log(JSON.stringify(report(state), null, 2)); return; }
  if (command === "run" || command === "resume") { await run(statePath, state, flag(args, "--from")); return; }
  throw new Error(`UNKNOWN_COMMAND:${command}`);
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main().catch((reason) => { console.error(reason instanceof Error ? reason.message : "FINAL_READINESS_FAILED"); process.exitCode = 1; });
