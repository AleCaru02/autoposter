import assert from "node:assert/strict";

const AUTH_URL = "https://ep-nameless-truth-a698bwer.neonauth.us-west-2.aws.neon.tech/neondb/auth";
const DATA_API = "https://ep-nameless-truth-a698bwer.apirest.us-west-2.aws.neon.tech/neondb/rest/v1";
const APP_BASE = "https://autoposter.02alessandrocaruso.workers.dev";
const marker = process.env.FASE7C_RUNTIME_MARKER || "";
const password = process.env.FASE7C_RUNTIME_PASSWORD || "";
const controllerUrl = process.env.FASE7C_RUNTIME_CONTROLLER_URL || "";
const controllerToken = process.env.FASE7C_RUNTIME_TOKEN_VALUE || "";

assert.match(marker, /^[a-z0-9]{10,32}$/);
assert.ok(password.length >= 24);
assert.ok(controllerUrl.startsWith("https://"));
assert.ok(controllerToken.length >= 32);

const emails = {
  owner: `fase7c-${marker}-owner@example.invalid`,
  other: `fase7c-${marker}-other@example.invalid`,
};
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
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { invalidJson: true, excerpt: text.slice(0, 120) }; }
}

async function authFetch(jar, path, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  headers.set("origin", APP_BASE);
  headers.set("referer", `${APP_BASE}/`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (jar.header()) headers.set("cookie", jar.header());
  const response = await fetch(`${AUTH_URL}${path}`, { ...init, headers, redirect: "manual" });
  jar.absorb(response.headers);
  return response;
}

function decodeSub(token) {
  const payload = token.split(".")[1];
  assert.ok(payload);
  const normalized = payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=");
  const body = JSON.parse(Buffer.from(normalized, "base64").toString("utf8"));
  assert.equal(typeof body.sub, "string");
  return body.sub;
}

async function identityToken(jar) {
  const response = await authFetch(jar, "/token");
  const body = await readJson(response);
  const token = body?.token || body?.data?.token || "";
  assert.ok(response.ok && token.length > 40, `Managed Auth token unavailable (${response.status})`);
  return token;
}

async function signUp(email, name) {
  const jar = new CookieJar();
  const response = await authFetch(jar, "/sign-up/email", { method: "POST", body: JSON.stringify({ email, password, name }) });
  assert.ok(response.ok, `Managed Auth signup failed (${response.status})`);
  const token = await identityToken(jar);
  return { token, id: decodeSub(token) };
}

async function dataApi(path, token, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return fetch(`${DATA_API}${path}`, { ...init, headers });
}

function rpcIdentity(body) {
  if (typeof body === "string") return body.trim() || null;
  const candidate = Array.isArray(body) ? body[0] : body;
  return candidate?.current_auth_user_id || candidate?.auth_user_id || candidate?.current_platform_identity || null;
}

async function waitForDataApiIdentity(token, expectedId) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await dataApi("/rpc/current_auth_user_id", token, { method: "POST", body: "{}" });
    const body = await readJson(response);
    if (response.ok && rpcIdentity(body) === expectedId) return;
    await sleep(500);
  }
  throw new Error("Data API did not recognize the ephemeral identity");
}

async function appApi(path, token, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return fetch(`${APP_BASE}${path}`, { ...init, headers });
}

async function controller(action) {
  const response = await fetch(controllerUrl, {
    method: "POST",
    headers: { "content-type": "application/json", "x-fase7c-runtime-token": controllerToken },
    body: JSON.stringify({ action, marker }),
  });
  const body = await readJson(response);
  assert.equal(response.status, 200, `controller ${action} failed (${response.status})`);
  return body;
}

function sensitiveFindings(value, path = "root", findings = []) {
  const sensitive = new Set(["password", "jwt", "authorization", "cookie", "sessiontoken", "accesstoken", "refreshtoken", "apikey", "databaseurl", "clientsecret"]);
  if (Array.isArray(value)) value.forEach((item, index) => sensitiveFindings(item, `${path}[${index}]`, findings));
  else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (sensitive.has(normalized) && child !== "[REDACTED]") findings.push(`${path}.${key}`);
      else sensitiveFindings(child, `${path}.${key}`, findings);
    }
  } else if (typeof value === "string") {
    if (value.includes(password) || value.includes(controllerToken) || /\bpostgres(?:ql)?:\/\//i.test(value) || /\bbearer\s+[a-z0-9._-]+/i.test(value)) findings.push(path);
  }
  return findings;
}

const preflight = await controller("preflight");
for (const key of ["qaUsers", "qaProfiles", "qaOwners", "qaContentItems", "qaContentVariants", "qaAssets", "qaPublicationJobs", "recognizedQaUsers"]) assert.equal(preflight[key], 0, `preflight residue ${key}`);
assert.equal(preflight.profilesWithoutOwner, 0);

const owner = await signUp(emails.owner, "FASE 7C QA Owner");
const other = await signUp(emails.other, "FASE 7C QA Other");
assert.notEqual(owner.id, other.id);
await waitForDataApiIdentity(owner.token, owner.id);
await waitForDataApiIdentity(other.token, other.id);

const anonymousText = await appApi("/api/generate-text", null, { method: "POST", body: "{}" });
assert.equal(anonymousText.status, 401);

const provisioningOperation = crypto.randomUUID();
const provisionResponse = await appApi("/api/onboarding-provision", owner.token, {
  method: "POST",
  body: JSON.stringify({ operationId: provisioningOperation, name: `FASE 7C QA ${marker}`, industry: "Consulenza immobiliare" }),
});
const provisionBody = await readJson(provisionResponse);
assert.equal(provisionResponse.status, 201, `onboarding provision failed (${provisionResponse.status})`);
const profileId = provisionBody?.profile?.id;
assert.match(profileId || "", /^[0-9a-f-]{36}$/i);

const provisionReplay = await appApi("/api/onboarding-provision", owner.token, {
  method: "POST",
  body: JSON.stringify({ operationId: provisioningOperation, name: `FASE 7C QA ${marker}`, industry: "Consulenza immobiliare" }),
});
const provisionReplayBody = await readJson(provisionReplay);
assert.equal(provisionReplay.status, 201);
assert.equal(provisionReplayBody?.profile?.id, profileId);

const completeResponse = await appApi("/api/onboarding-complete", owner.token, { method: "POST", body: JSON.stringify({ profileId }) });
assert.equal(completeResponse.status, 200, `onboarding completion failed (${completeResponse.status})`);

const brandResponse = await dataApi("/brand_profiles?select=profile_id", owner.token, {
  method: "POST",
  headers: { prefer: "return=representation" },
  body: JSON.stringify({
    profile_id: profileId,
    description: `Studio QA ${marker} che semplifica la gestione immobiliare per proprietari`,
    business_model: "Consulenza e gestione immobiliare",
    location: "Milano",
    service_area: "Lombardia",
    target_audience: { summary: "Proprietari che desiderano una gestione professionale", segments: ["Proprietari", "Investitori"] },
    tone_of_voice: { summary: "Competente, chiaro e rassicurante", traits: ["Pratico", "Professionale"] },
    goals: ["Più richieste", "Fiducia nel brand"],
    services: ["Gestione affitti", "Consulenza proprietari"],
    differentiators: ["Assistenza diretta"],
    value_propositions: ["Meno complessità per il proprietario"],
    visual_identity: { observedColors: ["#15c766", "#18211b"], summary: "Pulita e professionale" },
  }),
});
assert.ok(brandResponse.ok, `brand persistence failed (${brandResponse.status})`);

const otherProfiles = await dataApi(`/profiles?id=eq.${encodeURIComponent(profileId)}&select=id`, other.token);
assert.deepEqual(await readJson(otherProfiles), [], "cross-tenant profile read leaked");
const crossTenantGeneration = await appApi("/api/generate-text", other.token, {
  method: "POST",
  headers: { "x-post-automatici-operation-id": `fase7c-cross-${marker}` },
  body: JSON.stringify({ profileId, topic: `Tema cross tenant ${marker}`, providers: ["INSTAGRAM"], formats: ["POST"], researchMode: "WEBSITE_ONLY" }),
});
const crossTenantGenerationBody = await readJson(crossTenantGeneration);
assert.equal(crossTenantGeneration.status, 404, `cross-tenant generation expected 404, got ${crossTenantGeneration.status}:${crossTenantGenerationBody?.error || "unknown"}`);

const generationOperation = `fase7c-text-${marker}`;
const generationPayload = {
  profileId,
  topic: `Tre consigli pratici per proprietari, verifica QA ${marker}`,
  objective: "Generare richieste di consulenza qualificate",
  providers: ["INSTAGRAM", "LINKEDIN", "GBP"],
  formats: ["POST", "STORY"],
  researchMode: "WEBSITE_ONLY",
};
const generationResponse = await appApi("/api/generate-text", owner.token, {
  method: "POST",
  headers: { "x-post-automatici-operation-id": generationOperation },
  body: JSON.stringify(generationPayload),
});
const generationBody = await readJson(generationResponse);
if (generationResponse.status !== 200) {
  const failedState = await controller("state");
  assert.equal(generationResponse.status, 200, `text generation failed (${generationResponse.status}:${generationBody?.error || "unknown"}:${JSON.stringify(failedState.qaReleaseReasons || [])})`);
}
assert.ok(Array.isArray(generationBody?.content?.variants) && generationBody.content.variants.length >= 3);
const generatedVariants = generationBody.content.variants;
assert.ok(generatedVariants.some((variant) => variant.format === "POST"));
assert.ok(generatedVariants.some((variant) => variant.format === "STORY"));
assert.ok(generatedVariants.some((variant) => variant.provider === "GBP"));

const replayResponse = await appApi("/api/generate-text", owner.token, {
  method: "POST",
  headers: { "x-post-automatici-operation-id": generationOperation },
  body: JSON.stringify(generationPayload),
});
const replayBody = await readJson(replayResponse);
assert.equal(replayResponse.status, 200);
assert.equal(replayBody?.responseId, generationBody?.responseId);
assert.deepEqual(replayBody?.content, generationBody?.content);

const contentId = crypto.randomUUID();
const now = new Date().toISOString();
const itemResponse = await dataApi("/content_items?select=id", owner.token, {
  method: "POST",
  headers: { prefer: "return=representation" },
  body: JSON.stringify({ id: contentId, profile_id: profileId, topic: generationPayload.topic, objective: generationPayload.objective, title: generationBody.content.strategySummary.slice(0, 240), status: "IN_REVIEW", updated_at: now }),
});
assert.ok(itemResponse.ok, `content item persistence failed (${itemResponse.status})`);
const variantPayload = generatedVariants.map((variant) => ({
  id: crypto.randomUUID(), content_id: contentId, profile_id: profileId, provider: variant.provider, format: variant.format,
  eligible: variant.eligible, hook: variant.hook, caption: variant.caption, cta: variant.cta, hashtags: variant.hashtags,
  visual_brief: variant.visualBrief, alt_text: variant.altText, approval_status: "PENDING", updated_at: now,
}));
const variantsResponse = await dataApi("/content_variants?select=id,provider,format", owner.token, {
  method: "POST", headers: { prefer: "return=representation" }, body: JSON.stringify(variantPayload),
});
const savedVariants = await readJson(variantsResponse);
assert.ok(variantsResponse.ok && savedVariants?.length === variantPayload.length, `variant persistence failed (${variantsResponse.status})`);

const reloadResponse = await dataApi(`/content_variants?profile_id=eq.${encodeURIComponent(profileId)}&content_id=eq.${encodeURIComponent(contentId)}&select=id,caption,provider,format,image_asset_id,approval_status&order=created_at.asc`, owner.token);
const reloaded = await readJson(reloadResponse);
assert.equal(reloaded.length, variantPayload.length);
const otherContent = await dataApi(`/content_variants?profile_id=eq.${encodeURIComponent(profileId)}&select=id`, other.token);
assert.deepEqual(await readJson(otherContent), [], "cross-tenant content read leaked");

const editedCaption = `Copy modificato manualmente ${marker}`;
const firstVariant = reloaded[0];
const editResponse = await dataApi(`/content_variants?id=eq.${encodeURIComponent(firstVariant.id)}&profile_id=eq.${encodeURIComponent(profileId)}&select=id,caption`, owner.token, {
  method: "PATCH", headers: { prefer: "return=representation" }, body: JSON.stringify({ caption: editedCaption, approval_status: "PENDING", updated_at: new Date().toISOString() }),
});
const editBody = await readJson(editResponse);
assert.ok(editResponse.ok && editBody?.[0]?.caption === editedCaption, `manual edit failed (${editResponse.status})`);

const sourceVariant = generatedVariants.find((variant) => variant.provider === firstVariant.provider && variant.format === firstVariant.format) || generatedVariants[0];
const imageOperation = `fase7c-image-${marker}`;
const imagePayload = { profileId, contentVariantId: firstVariant.id, provider: firstVariant.provider, format: firstVariant.format, visualBrief: sourceVariant.visualBrief, caption: editedCaption };
const imageResponse = await appApi("/api/generate-image", owner.token, {
  method: "POST", headers: { "x-post-automatici-operation-id": imageOperation }, body: JSON.stringify(imagePayload),
});
const imageBody = await readJson(imageResponse);
assert.equal(imageResponse.status, 200, `image generation failed (${imageResponse.status}:${imageBody?.error || imageBody?.detail || "unknown"})`);
assert.match(imageBody?.asset?.id || "", /^[0-9a-f-]{36}$/i);
assert.ok(String(imageBody?.image?.dataUrl || "").startsWith("data:image/"));

const imageReplay = await appApi("/api/generate-image", owner.token, {
  method: "POST", headers: { "x-post-automatici-operation-id": imageOperation }, body: JSON.stringify(imagePayload),
});
const imageReplayBody = await readJson(imageReplay);
assert.equal(imageReplay.status, 200);
assert.equal(imageReplayBody?.asset?.id, imageBody.asset.id);
assert.equal(imageReplayBody?.duplicate, true);
assert.equal(imageReplayBody?.image?.dataUrl, null);

for (const variant of savedVariants) {
  const approval = await dataApi(`/content_variants?id=eq.${encodeURIComponent(variant.id)}&profile_id=eq.${encodeURIComponent(profileId)}`, owner.token, {
    method: "PATCH", headers: { prefer: "return=minimal" }, body: JSON.stringify({ approval_status: "APPROVED", updated_at: new Date().toISOString() }),
  });
  assert.ok(approval.ok, `variant approval failed (${approval.status})`);
}
const parentApproval = await dataApi(`/content_items?id=eq.${encodeURIComponent(contentId)}&profile_id=eq.${encodeURIComponent(profileId)}&select=id,status`, owner.token, {
  method: "PATCH", headers: { prefer: "return=representation" }, body: JSON.stringify({ status: "APPROVED", updated_at: new Date().toISOString() }),
});
const parentBody = await readJson(parentApproval);
assert.ok(parentApproval.ok && parentBody?.[0]?.status === "APPROVED");

const dashboardResponse = await fetch(`${APP_BASE}/app/dashboard`, { headers: { accept: "text/html" }, redirect: "manual" });
const dashboardHtml = await dashboardResponse.text();
assert.equal(dashboardResponse.status, 200);
assert.match(dashboardResponse.headers.get("content-type") || "", /text\/html/);
assert.match(dashboardHtml, /<div id="root"><\/div>/);

const during = await controller("state");
assert.equal(during.qaUsers, 2);
assert.equal(during.qaProfiles, 1);
assert.equal(during.qaOwners, 1);
assert.equal(during.qaBrandProfiles, 1);
assert.equal(during.qaContentItems, 1);
assert.equal(during.qaContentVariants, savedVariants.length);
assert.equal(during.qaAssets, 1);
assert.equal(during.qaPublicationJobs, 0, "runtime must not create a publication job");
assert.equal(during.qaPackageAssignments, 1);
assert.equal(during.qaTextCommitted, 1, "text replay must not consume a second logical unit");
assert.equal(during.qaImageCommitted, 1, "image replay must not consume a second logical unit");
assert.ok(during.qaAiUsageEvents >= 2, "technical AI usage events missing");
assert.deepEqual(sensitiveFindings({ provisionBody, generationBody, replayBody, imageReplayBody }), []);

console.log("FASE7C_CONTENT_RUNTIME: PASS", JSON.stringify({
  onboardingProvisioning: "PASS", onboardingCompletion: "PASS", brandContext: "PASS", providers: [...new Set(generatedVariants.map((variant) => variant.provider))],
  formats: [...new Set(generatedVariants.map((variant) => variant.format))], variants: savedVariants.length, manualEdit: "PASS", imagePersistence: "PASS",
  textReplay: "PASS", imageReplay: "PASS", tenantIsolation: "PASS", publicationJobs: 0, dashboardSpa: "PASS", sensitiveFindings: 0,
}));
