import { neon } from "@neondatabase/serverless";

export const QA_ACTION_PROVIDER = "AI_TEXT_QA_PROVIDER_CALL";
export const QA_ACTION_BARRIER = "AI_TEXT_QA_BARRIER_RELEASE";
export const QA_ACTION_BACKGROUND = "AI_TEXT_QA_BACKGROUND_DONE";
export const QA_EMAIL = /^ai-text-qa-([0-9]{8,24})@example\.invalid$/;
export const PREVIEW_HOST = /^aitextqa-[0-9]+-autoposter\.02alessandrocaruso\.workers\.dev$/;
let cachedSql = null;

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}
export function sameSecret(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}
export function validMarker(value) { return typeof value === "string" && /^[0-9]{8,24}$/.test(value); }
export function validProfileId(value) { return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value); }
export function validScenario(value) { return typeof value === "string" && /^[a-z0-9][a-z0-9-]{1,79}$/i.test(value); }
export function validOperationId(value) { return typeof value === "string" && /^[A-Za-z0-9._:-]{8,160}$/.test(value); }
export function previewRequest(request) { return PREVIEW_HOST.test(new URL(request.url).hostname); }
export function sqlFor(databaseUrl) {
  if (!databaseUrl) throw new Error("DATABASE_URL_REQUIRED");
  if (!cachedSql) cachedSql = neon(databaseUrl);
  return cachedSql;
}
export function currentSql() { return cachedSql; }
export async function requestBodyText(input, init) {
  if (typeof init?.body === "string") return init.body;
  if (input instanceof Request) {
    try { return await input.clone().text(); } catch { return ""; }
  }
  return "";
}
