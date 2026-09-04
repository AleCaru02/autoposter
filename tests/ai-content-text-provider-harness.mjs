const QA_PREFIX = "qa-ai-text.";
const ALLOWED_CALL_TYPES = new Set(["MAIN", "RESEARCH", "FACTCHECK", "EDITORIAL_QA"]);

function b64urlEncode(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function b64urlDecode(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
export function makeQaProviderKey(input) {
  const payload = {
    marker: String(input.marker || ""),
    profileId: String(input.profileId || ""),
    scenario: String(input.scenario || ""),
    operationId: String(input.operationId || ""),
    mode: String(input.mode || "fake"),
  };
  return `${QA_PREFIX}${b64urlEncode(JSON.stringify(payload))}`;
}
export function parseQaProviderKey(value) {
  if (typeof value !== "string" || !value.startsWith(QA_PREFIX)) return null;
  try {
    const parsed = JSON.parse(b64urlDecode(value.slice(QA_PREFIX.length)));
    if (!/^[0-9]{8,24}$/.test(parsed.marker || "")) return null;
    if (!/^[0-9a-f-]{36}$/i.test(parsed.profileId || "")) return null;
    if (!/^[a-z0-9][a-z0-9-]{1,79}$/i.test(parsed.scenario || "")) return null;
    if (!/^[A-Za-z0-9._:-]{8,160}$/.test(parsed.operationId || "")) return null;
    if (parsed.mode !== "fake") return null;
    return parsed;
  } catch {
    return null;
  }
}
export function openAiCallType(url, init = {}) {
  let parsed;
  try { parsed = new URL(typeof url === "string" ? url : url.url); } catch { return null; }
  if (parsed.hostname !== "api.openai.com") return null;
  if (parsed.pathname === "/v1/images/generations") return "IMAGE";
  if (parsed.pathname !== "/v1/responses") return "OPENAI_OTHER";
  let body = {};
  try {
    const raw = typeof init.body === "string" ? init.body : "";
    body = raw ? JSON.parse(raw) : {};
  } catch {}
  const name = body?.text?.format?.name;
  if (name === "post_automatici_social_content") return "MAIN";
  if (name === "post_automatici_research_agent") return "RESEARCH";
  if (name === "post_automatici_fact_check_agent") return "FACTCHECK";
  if (name === "post_automatici_editorial_qa") return "EDITORIAL_QA";
  if (name === "post_automatici_strategy") return "STRATEGIST";
  if (name === "post_automatici_editorial_plan") return "PLANNER";
  return "RESPONSES_OTHER";
}
export function allowedProviderCallType(value) {
  return ALLOWED_CALL_TYPES.has(value);
}
function responseEnvelope(output, callType, includeSource = false) {
  const message = { type: "message", content: [{ type: "output_text", text: JSON.stringify(output) }] };
  const items = includeSource
    ? [{ type: "web_search_call", action: { sources: [{ url: "https://example.com/qa-source" }] } }, message]
    : [message];
  return {
    id: `resp_qa_${callType.toLowerCase()}`,
    model: "gpt-5.6-terra",
    output_text: JSON.stringify(output),
    output: items,
    usage: { input_tokens: 120, output_tokens: 60, total_tokens: 180, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 } },
  };
}
function mainOutput(correlation, requestBody) {
  let task = {};
  try { task = JSON.parse(requestBody?.input || "{}")?.task || {}; } catch {}
  const providers = Array.isArray(task.providers) && task.providers.length ? task.providers : ["INSTAGRAM"];
  const formats = Array.isArray(task.formats) && task.formats.length ? task.formats : ["POST"];
  const numeric = /factcheck-no-double-count|research-no-double-count/.test(String(correlation.scenario));
  const tag = String(correlation.scenario).replace(/[^A-Za-z-]+/g, "-").slice(0, 48);
  const variants = [];
  for (const provider of providers) {
    for (const format of formats) {
      variants.push({
        provider,
        format,
        eligible: true,
        hook: `QA ${tag}`,
        caption: numeric ? `Contenuto QA verificabile per il 2026 · ${tag}` : `Contenuto QA isolato · ${tag}`,
        cta: null,
        hashtags: ["#qa"],
        visualBrief: `Visual QA astratto ${tag}`,
        altText: `Visual QA ${tag}`,
        factualBasis: numeric ? ["BASE ESTERNA: fonte QA controllata"] : ["BASE BRAND/SITO: fixture QA"],
      });
    }
  }
  return { editorialTopic: `QA ${tag}`.slice(0, 120), editorialAngle: `Verifica runtime ${tag}`.slice(0, 180), strategySummary: "Fixture controllata del verifier.", variants };
}
export function fakeOpenAiPlan({ callType, correlation, requestBody }) {
  const scenario = correlation?.scenario || "";
  const barrier = /duplicate-reserved|concurrent-distinct|concurrent-duplicate/.test(scenario) && callType === "MAIN";
  if (!allowedProviderCallType(callType)) {
    return {
      barrier: false,
      status: 500,
      headers: { "content-type": "application/json" },
      body: { error: { code: "RUNTIME_VERIFIER_NOT_CERTIFIED", message: `Unsupported controlled provider call ${callType}` } },
    };
  }
  if (scenario === "provider-failure-release" && callType === "MAIN") {
    return {
      barrier,
      status: 502,
      headers: { "content-type": "application/json", "x-request-id": `AI_TEXT_QA_${correlation.marker}_${correlation.scenario}_${correlation.operationId}` },
      body: { error: { code: "OPENAI_QA_PROVIDER_FAILURE", message: "Controlled verifier provider failure" } },
    };
  }
  let output;
  let includeSource = false;
  if (callType === "MAIN") {
    output = mainOutput(correlation, requestBody);
    includeSource = Array.isArray(requestBody?.tools) && requestBody.tools.some((item) => item?.type === "web_search");
  } else if (callType === "RESEARCH") {
    output = {
      status: "READY",
      summary: "Evidenza QA controllata.",
      evidence: [{ claim: "Evidenza QA", evidenceSummary: "Fonte controllata del verifier.", sourceType: "OFFICIAL", datedAt: "2026-09-04", reliability: "HIGH" }],
    };
    includeSource = true;
  } else if (callType === "FACTCHECK") {
    output = { verdict: "PASS", checkedClaims: [{ claim: "Contenuto QA 2026", status: "VERIFIED", reason: "Fixture provider controllata." }] };
    includeSource = true;
  } else {
    output = {
      verdict: "PASS",
      reasons: [],
      checks: { brandConsistency: "PASS", platformFit: "PASS", formatFit: "PASS", ctaFit: "PASS", claimSafety: "PASS", visualSafety: "PASS" },
    };
  }
  return {
    barrier,
    status: 200,
    headers: { "content-type": "application/json", "x-request-id": `AI_TEXT_QA_${correlation.marker}_${correlation.scenario}_${correlation.operationId}_${callType}` },
    body: responseEnvelope(output, callType, includeSource),
  };
}
export function safeProviderRecord(correlation, callType) {
  return {
    marker: correlation.marker,
    profileId: correlation.profileId,
    scenario: correlation.scenario,
    operationId: correlation.operationId,
    callType,
  };
}
export function technicalPersistenceFailureBody(raw) {
  if (typeof raw !== "string") return false;
  return raw.includes("insert into public.ai_usage_events")
    && raw.includes("metering-persistence-failure")
    && raw.includes("AI_TEXT_QA_");
}
