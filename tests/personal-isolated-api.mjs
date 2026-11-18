import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const app = "https://post-automatici-canonical-env-reel-qa-ales-projects-b8ec22ac.vercel.app";
const dataApi = "https://ep-damp-credit-bfj03vrj.apirest.c-5.us-west-2.aws.neon.tech/neondb/rest/v1";
if (process.env.PERSONAL_QA_ALLOW_TEST_WRITES !== "true") throw new Error("ISOLATED_QA_TEST_WRITES_NOT_ENABLED");
const cookies = new Map();
let jwt = null;
let profileId = null;

function requireCheck(condition, code) { if (!condition) throw new Error(code); }
function configValue(value) { return '"' + String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n").replaceAll("\r", "\\r") + '"'; }

async function api(path, { method = "GET", body, forms, authenticated = true, protectionCookie = false } = {}) {
  requireCheck(path.startsWith("/api/") && !path.includes("\n"), "QA_API_PATH_INVALID");
  const cli = process.platform === "win32"
    ? { file: process.execPath, args: [join(process.env.APPDATA, "npm/node_modules/vercel/dist/vc.js")] }
    : { file: "vercel", args: [] };
  const config = [
    "request = " + configValue(method),
    "header = " + configValue("Origin: " + app),
    ...(protectionCookie ? ["header = " + configValue("x-vercel-set-bypass-cookie: true")] : []),
    ...(forms ? [] : ["header = " + configValue("Content-Type: application/json")]),
    ...(cookies.size ? ["header = " + configValue("Cookie: " + [...cookies].map(([name, value]) => name + "=" + value).join("; "))] : []),
    ...(authenticated && jwt ? ["header = " + configValue("Authorization: Bearer " + jwt)] : []),
    ...(body === undefined ? [] : ["data = " + configValue(JSON.stringify(body))]),
    ...(forms ?? []).map((field) => "form = " + configValue(field)),
  ].join("\n") + "\n";
  const output = await new Promise((resolve, reject) => {
    const child = spawn(cli.file, [...cli.args, "curl", path, "--deployment", app, "--", "--silent", "--show-error", "--max-time", "60", "--include", "--write-out", "\n__QA_HTTP_STATUS__:%{http_code}", "--config", "-"], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", () => {});
    child.on("error", () => reject(new Error("QA_VERCEL_CLI_START_FAILED")));
    child.on("close", (code) => code === 0 ? resolve(stdout) : reject(new Error("QA_VERCEL_CURL_FAILED")));
    child.stdin.end(config);
  });
  const marker = output.lastIndexOf("\n__QA_HTTP_STATUS__:");
  requireCheck(marker >= 0, "QA_HTTP_STATUS_MISSING");
  const status = Number(output.slice(marker).split(":").at(-1));
  let payload = output.slice(0, marker).trimStart();
  while (payload.startsWith("HTTP/")) {
    const boundary = /\r?\n\r?\n/.exec(payload);
    requireCheck(boundary, "QA_HTTP_HEADERS_INVALID");
    const headers = payload.slice(0, boundary.index);
    for (const line of headers.split(/\r?\n/)) {
      if (!/^set-cookie:/i.test(line)) continue;
      const pair = line.slice(line.indexOf(":") + 1).trim().split(";", 1)[0];
      const equals = pair.indexOf("=");
      if (equals > 0) cookies.set(pair.slice(0, equals), pair.slice(equals + 1));
    }
    payload = payload.slice(boundary.index + boundary[0].length).trimStart();
  }
  let json = null;
  try { json = JSON.parse(payload); } catch {}
  return { status, json };
}

function uploadFixture() {
  const crc32 = (bytes) => {
    let value = 0xffffffff;
    for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0); }
    return (value ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, bytes) => {
    const name = Buffer.from(type);
    const length = Buffer.alloc(4); length.writeUInt32BE(bytes.length);
    const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([name, bytes])));
    return Buffer.concat([length, name, bytes, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(256, 0); header.writeUInt32BE(256, 4); header[8] = 8; header[9] = 6;
  const raw = Buffer.alloc((256 * 4 + 1) * 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const offset = y * (256 * 4 + 1) + 1 + x * 4;
    raw[offset] = 35; raw[offset + 1] = 126; raw[offset + 2] = 85; raw[offset + 3] = 255;
  }
  const bytes = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
  const directory = new URL("../qa-artifacts/", import.meta.url);
  mkdirSync(directory, { recursive: true });
  const path = fileURLToPath(new URL("qa-upload-fixture.png", directory));
  writeFileSync(path, bytes);
  return { path, bytes };
}

async function verifyAssetLibrary() {
  const fixture = uploadFixture();
  const forms = ["profileId=" + profileId, "images=@" + fixture.path.replaceAll("\\", "/") + ";filename=qa-upload-fixture.png;type=image/png"];
  const upload = await api("/api/assets", { method: "POST", forms });
  requireCheck(upload.status === 201 && upload.json?.saved?.length === 1 && upload.json.saved[0].duplicate === false, "QA_ASSET_UPLOAD_HTTP_" + upload.status);
  const assetId = upload.json.saved[0].id;
  const duplicate = await api("/api/assets", { method: "POST", forms });
  requireCheck(duplicate.status === 201 && duplicate.json?.saved?.[0]?.duplicate === true && duplicate.json.saved[0].id === assetId, "QA_ASSET_UPLOAD_NOT_DEDUPLICATED");
  const list = await api("/api/assets?profileId=" + profileId + "&q=qa-upload-fixture");
  requireCheck(list.status === 200 && list.json?.assets?.some((asset) => asset.id === assetId), "QA_ASSET_NOT_IN_LIBRARY");
  const preview = await api("/api/assets?profileId=" + profileId + "&previewAssetId=" + assetId);
  requireCheck(preview.status === 200 && /^https:\/\/[a-z0-9]+\.public\.blob\.vercel-storage\.com\//.test(preview.json?.previewUrl ?? ""), "QA_ASSET_PREVIEW_UNAVAILABLE");
  const fetched = await fetch(preview.json.previewUrl, { redirect: "manual", signal: AbortSignal.timeout(30000) });
  requireCheck(fetched.status === 200 && Buffer.from(await fetched.arrayBuffer()).equals(fixture.bytes), "QA_ASSET_BYTES_CHANGED");
  console.log("ISOLATED_QA_ASSET_UPLOAD_DEDUP_PREVIEW = PASS");

  const contentId = randomUUID(), variantId = randomUUID();
  const item = await data("/content_items", { method: "POST", body: { id: contentId, profile_id: profileId, topic: "QA libreria", title: "QA riutilizzo asset", status: "IN_REVIEW" } });
  requireCheck(item.status >= 200 && item.status < 300, "QA_ASSET_CONTENT_HTTP_" + item.status);
  const variant = await data("/content_variants", { method: "POST", body: { id: variantId, content_id: contentId, profile_id: profileId, provider: "INSTAGRAM", format: "POST", eligible: true, caption: "Questo contenuto serve esclusivamente alla verifica tecnica isolata della libreria e non viene pubblicato.", hashtags: [], visual_brief: "Fixture tecnica della libreria." } });
  requireCheck(variant.status >= 200 && variant.status < 300, "QA_ASSET_VARIANT_HTTP_" + variant.status);
  const linked = await api("/api/assets", { method: "POST", body: { action: "LINK_TO_VARIANT", profileId, assetId, variantId } });
  requireCheck(linked.status === 200, "QA_ASSET_REUSE_HTTP_" + linked.status);
  const saved = await data("/content_variants?id=eq." + variantId + "&select=image_asset_id,approval_status,qa_status");
  requireCheck(saved.status === 200 && saved.json?.[0]?.image_asset_id === assetId && saved.json[0].approval_status === "PENDING" && saved.json[0].qa_status !== "PASS", "QA_ASSET_REUSE_NOT_SAFELY_PERSISTED");
  console.log("ISOLATED_QA_ASSET_REUSE_PERSISTENCE = PASS");
  if (process.env.PERSONAL_QA_WORKFLOWS === "true") {
    const current = await data("/content_variants?id=eq." + variantId + "&select=updated_at");
    requireCheck(current.status === 200 && current.json?.[0]?.updated_at, "QA_REVIEW_VERSION_MISSING");
    const reviewBody = { profileId, contentId, variantId, expectedUpdatedAt: current.json[0].updated_at, hook: "Verifica libreria", caption: "Test tecnico isolato: testo modificato e salvato nella revisione del contenuto.", cta: "", hashtags: [], visualBrief: "Fixture tecnica della libreria.", altText: "Immagine tecnica verde", approvalStatus: "CHANGES_REQUESTED", rejectedReason: "Il tono richiede una revisione tecnica." };
    const reviewed = await api("/api/content-review", { method: "POST", body: reviewBody });
    requireCheck(reviewed.status === 200 && reviewed.json?.approvalStatus === "CHANGES_REQUESTED", "QA_REVIEW_HTTP_" + reviewed.status);
    const stale = await api("/api/content-review", { method: "POST", body: reviewBody });
    requireCheck(stale.status === 409, "QA_REVIEW_STALE_WRITE_ACCEPTED");
    const persisted = await data("/content_variants?id=eq." + variantId + "&select=caption,approval_status,qa_status");
    requireCheck(persisted.status === 200 && persisted.json?.[0]?.caption === reviewBody.caption && persisted.json[0].approval_status === "CHANGES_REQUESTED" && persisted.json[0].qa_status !== "PASS", "QA_REVIEW_NOT_PERSISTED");
    console.log("ISOLATED_QA_REVIEW_EDIT_CONFLICT = PASS");
  }
}

async function data(path, { method = "GET", body } = {}) {
  requireCheck(jwt, "QA_JWT_REQUIRED");
  requireCheck(path.startsWith("/") && !/[\r\n]/.test(path), "QA_DATA_PATH_INVALID");
  const config = [
    "request = " + configValue(method),
    "header = " + configValue("Authorization: Bearer " + jwt),
    "header = " + configValue("Content-Type: application/json"),
    "header = " + configValue("Prefer: return=representation"),
    ...(body === undefined ? [] : ["data = " + configValue(JSON.stringify(body))]),
  ].join("\n") + "\n";
  const output = await new Promise((resolve, reject) => {
    const child = spawn(process.platform === "win32" ? "curl.exe" : "curl", [dataApi + path, "--silent", "--show-error", "--max-time", "60", "--write-out", "\n__QA_HTTP_STATUS__:%{http_code}", "--config", "-"], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", () => {});
    child.on("error", () => reject(new Error("QA_DATA_CURL_START_FAILED")));
    child.on("close", (code) => code === 0 ? resolve(stdout) : reject(new Error("QA_DATA_CURL_EXIT_" + code)));
    child.stdin.end(config);
  });
  const marker = output.lastIndexOf("\n__QA_HTTP_STATUS__:");
  requireCheck(marker >= 0, "QA_DATA_HTTP_STATUS_MISSING");
  let json = null;
  try { json = JSON.parse(output.slice(0, marker)); } catch {}
  return { status: Number(output.slice(marker).split(":").at(-1)), json };
}

async function verifyReelDryRun() {
  const status = await api("/api/render/status?profileId=" + profileId);
  requireCheck(status.status === 200 && status.json?.engine?.dryRunAvailable === true, "QA_REEL_DRY_RUN_UNAVAILABLE");
  requireCheck((status.json.engine.missing ?? []).every((key) => key === "OPENAI_API_KEY"), "QA_REEL_STORAGE_OR_ENGINE_UNCONFIGURED");
  const contentId = randomUUID();
  const variantId = randomUUID();
  const caption = [
    "Questa prova tecnica verifica un processo completo e isolato, senza utilizzare dati personali o pubblicare contenuti sui social.",
    "Il testo rimane nella revisione e permette di controllare il collegamento tra la coda e il file video generato.",
    "Audio e sottotitoli devono restare sincronizzati per rendere il messaggio comprensibile anche durante la visione da telefono.",
    "Il risultato viene salvato nella libreria di prova e controllato prima di qualsiasi possibile utilizzo editoriale successivo.",
  ].join(" ");
  const content = await data("/content_items", { method: "POST", body: { id: contentId, profile_id: profileId, topic: "QA tecnica isolata", title: "Prova tecnica Reel", status: "IN_REVIEW" } });
  requireCheck(content.status >= 200 && content.status < 300, "QA_REEL_SOURCE_ITEM_HTTP_" + content.status);
  const variant = await data("/content_variants", { method: "POST", body: { id: variantId, content_id: contentId, profile_id: profileId, provider: "INSTAGRAM", format: "POST", eligible: true, hook: "Prova tecnica del processo video", caption, cta: "Solo verifica tecnica", hashtags: [], visual_brief: "Prova a secco tecnica, senza immagini AI o pubblicazioni esterne." } });
  requireCheck(variant.status >= 200 && variant.status < 300, "QA_REEL_SOURCE_VARIANT_HTTP_" + variant.status);
  const body = { profileId, sourceVariantId: variantId, requestId: randomUUID(), dryRun: true, duration: { minSeconds: 20, maxSeconds: 30 } };
  const invalid = await api("/api/render/enqueue", { method: "POST", body: { ...body, duration: { minSeconds: 30, maxSeconds: 20 } } });
  requireCheck(invalid.status === 400 && invalid.json?.error === "REEL_DURATION_INVALID", "QA_REEL_INVALID_DURATION_NOT_REJECTED");
  const queued = await api("/api/render/enqueue", { method: "POST", body });
  requireCheck(queued.status === 202 && queued.json?.jobId, "QA_REEL_ENQUEUE_HTTP_" + queued.status);
  const replay = await api("/api/render/enqueue", { method: "POST", body });
  requireCheck(replay.status === 202 && replay.json?.jobId === queued.json.jobId, "QA_REEL_REPLAY_DUPLICATE_JOB");
  console.log("ISOLATED_QA_REEL_QUEUE_IDEMPOTENT = PASS");
  const deadline = Date.now() + 240000;
  let job = null;
  let previous = "";
  while (Date.now() < deadline) {
    const current = await api("/api/render/status?profileId=" + profileId);
    requireCheck(current.status === 200, "QA_REEL_STATUS_HTTP_" + current.status);
    job = current.json?.jobs?.find((entry) => entry.id === queued.json.jobId);
    requireCheck(job, "QA_REEL_JOB_MISSING");
    const state = job.state + ":" + job.step;
    if (state !== previous) { console.log("ISOLATED_QA_REEL_PROGRESS", state); previous = state; }
    if (job.state === "FAILED") throw new Error("QA_REEL_FAILED_" + (/^[A-Z0-9_]+$/.test(job.last_error_code ?? "") ? job.last_error_code : "UNKNOWN"));
    if (job.state === "READY_FOR_REVIEW") break;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  requireCheck(job?.state === "READY_FOR_REVIEW", "QA_REEL_PIPELINE_TIMEOUT");
  requireCheck(job.dry_run === true && Number(job.cost_usd) === 0, "QA_REEL_DRY_RUN_COST_OR_MARKER_INVALID");
  requireCheck(job.duration_seconds >= 20 && job.duration_seconds <= 30, "QA_REEL_DURATION_OUTSIDE_POLICY");
  const output = await data("/content_variants?id=eq." + job.output_variant_id + "&select=id,format,eligible,approval_status,video_asset_id");
  requireCheck(output.status === 200 && output.json?.[0]?.format === "REEL" && output.json[0].eligible === false && output.json[0].approval_status !== "APPROVED" && output.json[0].video_asset_id, "QA_REEL_OUTPUT_NOT_SAFELY_PERSISTED");
  requireCheck(/^https:\/\/[a-z0-9]+\.public\.blob\.vercel-storage\.com\//.test(job.video_url ?? ""), "QA_REEL_VIDEO_URL_UNEXPECTED");
  const video = await fetch(job.video_url, { redirect: "manual", signal: AbortSignal.timeout(30000) });
  requireCheck(video.status === 200 && /video\/mp4/.test(video.headers.get("content-type") ?? ""), "QA_REEL_VIDEO_NOT_READABLE");
  const bytes = Buffer.from(await video.arrayBuffer());
  requireCheck(bytes.length > 1000 && bytes.subarray(4, 8).toString() === "ftyp", "QA_REEL_VIDEO_NOT_MP4");
  console.log("ISOLATED_QA_REEL_DRY_RUN_PIPELINE = PASS");
  console.log("ISOLATED_QA_REEL_ARTIFACT", JSON.stringify({ durationSeconds: job.duration_seconds, bytes: bytes.length, providerCostUsd: job.cost_usd }));
}

async function verifyBrandAndCalendar() {
  const existing = await data("/brand_profiles?profile_id=eq." + profileId + "&select=profile_id");
  requireCheck(existing.status === 200 && Array.isArray(existing.json), "QA_BRAND_READ_FAILED");
  const payload = { description: "Brand tecnico della verifica isolata", user_context: "Contesto salvato dal collaudo senza dati reali", tone_of_voice: { summary: "Chiaro e operativo", traits: ["concreto"] } };
  const saved = await data(existing.json.length ? "/brand_profiles?profile_id=eq." + profileId : "/brand_profiles", { method: existing.json.length ? "PATCH" : "POST", body: existing.json.length ? payload : { profile_id: profileId, ...payload } });
  requireCheck(saved.status >= 200 && saved.status < 300, "QA_BRAND_SAVE_HTTP_" + saved.status);
  const persisted = await data("/brand_profiles?profile_id=eq." + profileId + "&select=description,user_context,tone_of_voice");
  requireCheck(persisted.status === 200 && persisted.json?.[0]?.description === payload.description && persisted.json[0].user_context === payload.user_context && persisted.json[0].tone_of_voice?.summary === payload.tone_of_voice.summary, "QA_BRAND_NOT_PERSISTED");
  console.log("ISOLATED_QA_BRAND_PERSISTENCE = PASS");
  const schedule = { action: "SAVE_SCHEDULE", profileId, provider: "LINKEDIN", timezone: "Europe/Rome", postsPerWeek: 2, preferredSlots: [{ day: 2, time: "09:30" }], autoChoose: false, enabled: false };
  const first = await api("/api/calendar", { method: "POST", body: schedule });
  requireCheck(first.status === 200 && first.json?.scheduleId, "QA_CALENDAR_SAVE_HTTP_" + first.status);
  const changed = await api("/api/calendar", { method: "POST", body: { ...schedule, postsPerWeek: 3 } });
  requireCheck(changed.status === 200 && changed.json?.scheduleId === first.json.scheduleId, "QA_CALENDAR_SCHEDULE_DUPLICATED");
  const read = await data("/schedules?profile_id=eq." + profileId + "&provider=eq.LINKEDIN&select=timezone,posts_per_week,preferred_slots,enabled");
  requireCheck(read.status === 200 && read.json?.length === 1 && read.json[0].posts_per_week === 3 && read.json[0].timezone === schedule.timezone && read.json[0].preferred_slots?.[0]?.time === "09:30" && read.json[0].enabled === false, "QA_CALENDAR_SCHEDULE_NOT_PERSISTED");
  const invalid = await api("/api/calendar", { method: "POST", body: { ...schedule, timezone: "Invalid/Timezone" } });
  requireCheck(invalid.status === 400, "QA_CALENDAR_INVALID_TIMEZONE_ACCEPTED");
  const foreign = await api("/api/calendar", { method: "POST", body: { ...schedule, profileId: "08d029d7-40dd-4885-b0fb-1114206923b5" } });
  requireCheck(foreign.status === 403, "QA_FOREIGN_CALENDAR_WRITE_ACCEPTED");
  console.log("ISOLATED_QA_CALENDAR_SCHEDULE_ISOLATION = PASS");
}

async function main() {
  if (process.env.PERSONAL_QA_BROWSER === "true") {
    await api("/api/health", { authenticated: false, protectionCookie: true });
    requireCheck([...cookies.keys()].some((name) => /vercel/i.test(name)), "QA_BROWSER_PROTECTION_COOKIE_MISSING");
  }
  const health = await api("/api/health", { authenticated: false });
  requireCheck(health.status === 200 && health.json?.ready === true && health.json?.runtime?.targetEnv === "reel-qa" && health.json?.runtime?.isolatedNeon === true, "QA_ISOLATION_NOT_VERIFIED");
  console.log("ISOLATED_QA_HEALTH = PASS");

  const signup = await api("/api/auth/sign-up/email", { method: "POST", authenticated: false, body: { name: "QA funzionale isolata", email: "qa-" + randomUUID() + "@example.invalid", password: randomBytes(24).toString("base64url") } });
  requireCheck(signup.status >= 200 && signup.status < 300 && signup.json?.user?.id, "QA_SIGNUP_HTTP_" + signup.status);
  const session = await api("/api/auth/get-session", { authenticated: false });
  requireCheck(session.status === 200 && session.json?.user?.id === signup.json.user.id, "QA_SESSION_NOT_PERSISTED");
  const token = await api("/api/auth/token", { authenticated: false });
  requireCheck(token.status === 200 && typeof token.json?.token === "string", "QA_TOKEN_HTTP_" + token.status);
  jwt = token.json.token;
  console.log("ISOLATED_QA_EMAIL_SESSION_JWT = PASS");

  const operationId = randomUUID();
  const provisionBody = { operationId, name: "QA API " + randomUUID(), websiteUrl: null, industry: "Verifica tecnica interna", profileType: "BUSINESS" };
  const provision = await api("/api/onboarding-provision", { method: "POST", body: provisionBody });
  requireCheck(provision.status >= 200 && provision.status < 300 && provision.json?.profile?.id, "QA_PROVISION_HTTP_" + provision.status);
  profileId = provision.json.profile.id;
  const replay = await api("/api/onboarding-provision", { method: "POST", body: provisionBody });
  requireCheck(replay.status >= 200 && replay.status < 300 && replay.json?.profile?.id === profileId, "QA_PROVISION_REPLAY_CREATED_DUPLICATE");
  const complete = await api("/api/onboarding-complete", { method: "POST", body: { profileId } });
  requireCheck(complete.status === 200, "QA_ONBOARDING_COMPLETE_HTTP_" + complete.status);
  console.log("ISOLATED_QA_PROFILE_CREATE_IDEMPOTENT = PASS");

  const editedName = provisionBody.name + " modificata";
  const edited = await data("/profiles?id=eq." + profileId, { method: "PATCH", body: { name: editedName } });
  requireCheck(edited.status >= 200 && edited.status < 300, "QA_PROFILE_EDIT_HTTP_" + edited.status);
  const read = await data("/profiles?id=eq." + profileId + "&select=id,name,onboarding_completed");
  requireCheck(read.status === 200 && read.json?.length === 1 && read.json[0].name === editedName && read.json[0].onboarding_completed === true, "QA_PROFILE_EDIT_NOT_PERSISTED");
  console.log("ISOLATED_QA_PROFILE_EDIT_PERSISTENCE = PASS");

  const foreign = await data("/profiles?id=eq.08d029d7-40dd-4885-b0fb-1114206923b5&select=id");
  requireCheck(foreign.status === 200 && Array.isArray(foreign.json) && foreign.json.length === 0, "QA_FOREIGN_PROFILE_VISIBLE");
  const forbidden = await api("/api/render/status?profileId=08d029d7-40dd-4885-b0fb-1114206923b5");
  requireCheck(forbidden.status === 404, "QA_FOREIGN_PROFILE_RENDER_ACCESS");
  console.log("ISOLATED_QA_TENANT_BOUNDARIES = PASS");
  if (process.env.PERSONAL_QA_WORKFLOWS === "true") await verifyBrandAndCalendar();
  if (process.env.PERSONAL_QA_BROWSER === "true") {
    const { verifyIsolatedBrowser } = await import("./personal-isolated-browser.mjs");
    await verifyIsolatedBrowser({ app, cookies });
  }
  if (process.env.PERSONAL_QA_ASSETS === "true") await verifyAssetLibrary();
  if (process.env.PERSONAL_QA_REEL_DRY_RUN === "true") await verifyReelDryRun();
}

try { await main(); }
catch (error) { console.error(error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : "ISOLATED_QA_UNEXPECTED_ERROR"); process.exitCode = 1; }
finally {
  if (profileId && jwt) {
    try {
      const archived = await api("/api/profile-archive", { method: "POST", body: { profileId } });
      requireCheck(archived.status === 200 && archived.json?.archived === true, "QA_PROFILE_CLEANUP_HTTP_" + archived.status);
      const remaining = await data("/profiles?id=eq." + profileId + "&archived_at=is.null&select=id");
      requireCheck(remaining.status === 200 && remaining.json?.length === 0, "QA_ARCHIVED_PROFILE_STILL_ACTIVE");
      console.log("ISOLATED_QA_REVERSIBLE_CLEANUP = PASS");
    } catch (error) { console.error(error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : "ISOLATED_QA_CLEANUP_UNCONFIRMED"); process.exitCode = 1; }
  }
}
