import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { classifyProviderFailure, instagramContainerDecision, retryDelaySeconds } from "../api/_lib/social.js";

const [migration, social, store, calendar, dashboard, wrangler, entry] = await Promise.all([
  readFile("db/migrations/20260908_fase7f_safe_publication_engine.sql", "utf8"),
  readFile("api/_lib/social.ts", "utf8"),
  readFile("src/features/calendar/calendar-store.ts", "utf8"),
  readFile("src/pages/calendar-page.tsx", "utf8"),
  readFile("src/pages/dashboard-page.tsx", "utf8"),
  readFile("wrangler.jsonc", "utf8"),
  readFile("cloudflare/entry.ts", "utf8"),
]);
const publisher = social.slice(social.indexOf("async function publishInstagram"), social.indexOf("export async function handleSocialApi"));

// Durable lifecycle and concurrency.
assert.match(migration, /FOR UPDATE SKIP LOCKED/i);
assert.match(migration, /state='PROCESSING'/);
assert.match(migration, /attempt_count=job\.attempt_count\+1/);
assert.match(migration, /attempt_count < 3/);
assert.match(migration, /lease_expires_at/);
assert.match(migration, /state='OUTCOME_UNKNOWN'/);
assert.match(migration, /attempt\.state='REQUEST_SENT'/);
assert.match(migration, /next_attempt_at/);
assert.match(migration, /job\.scheduled_at <= clock_timestamp\(\)/, "jobs must never publish before their original schedule");
assert.match(migration, /variant\.approval_status='APPROVED'.*variant\.eligible IS TRUE/s, "approval must be rechecked at the remote-write boundary");

// Atomic local completion and metering.
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.complete_publication_job/);
assert.match(migration, /PUBLICATION_METERING_REQUIRED/);
assert.match(migration, /PUBLICATION_REQUEST_BOUNDARY_REQUIRED/);
assert.match(migration, /UPDATE public\.publication_attempts[\s\S]*state='SUCCESS'/);
assert.match(migration, /UPDATE public\.content_variants[\s\S]*external_post_id=p_remote_post_id/);
assert.match(migration, /UPDATE public\.publication_jobs[\s\S]*state='PUBLISHED'/);
assert.match(migration, /PERFORM public\.commit_capability_usage\(p_usage_event_id\)/);
assert.match(migration, /REVOKE ALL ON FUNCTION public\.claim_due_publication_jobs[\s\S]*FROM PUBLIC, authenticated/);
assert.match(migration, /REVOKE ALL ON FUNCTION public\.complete_publication_job[\s\S]*FROM PUBLIC, authenticated/);

// Server routing, capability checks, and removal of the unsafe bypass.
assert.match(social, /canUseCapability\(job\.profile_id, "social\.publish\.scheduled"\)/);
assert.match(social, /idempotencyKey: `publication:v1:\$\{job\.id\}`/);
assert.match(social, /attach_publication_usage_event/);
assert.match(social, /mark_publication_request_started/);
assert.match(social, /complete_publication_job/);
assert.match(social, /fail_publication_job/);
assert.match(social, /PUBLISH_VIA_CALENDAR_REQUIRED/);
assert.doesNotMatch(social, /async function handlePublishNow/);
assert.match(wrangler, /\*\/5 \* \* \* \*/);
assert.match(entry, /processDuePublications/);

// Provider safety: bounded requests, safe errors, and profile-bound assets.
assert.match(social, /AbortController/);
assert.match(social, /25_000/);
assert.match(social, /providerJson/);
assert.match(social, /media:\$\{profileId\}:\$\{assetId\}:\$\{exp\}/);
assert.match(social, /a\.profile_id = v\.profile_id/);
assert.match(social, /where id=\$\{assetId\}::uuid and profile_id=\$\{profileId\}::uuid/);
assert.doesNotMatch(publisher, /error\?\.message/);
assert.match(publisher, /waitForInstagramContainer/);
assert.match(social, /const attempts = 15/);
assert.match(social, /setTimeout\(resolve, 2_000\)/);
assert.equal(instagramContainerDecision("FINISHED"), "READY");
assert.equal(instagramContainerDecision("IN_PROGRESS"), "PENDING");
assert.equal(instagramContainerDecision("ERROR"), "TERMINAL");
assert.equal(instagramContainerDecision("EXPIRED"), "TERMINAL");

const rateLimit = classifyProviderFailure("FACEBOOK", "PUBLISH", 429, true);
assert.equal(rateLimit.retryable, true);
assert.equal(rateLimit.outcomeUnknown, false);
assert.equal(rateLimit.code, "FACEBOOK_RATE_LIMITED");
const auth = classifyProviderFailure("INSTAGRAM", "PUBLISH", 401, false);
assert.equal(auth.retryable, false);
assert.equal(auth.code, "INSTAGRAM_RECONNECT_REQUIRED");
const rejection = classifyProviderFailure("LINKEDIN", "PUBLISH", 422, true);
assert.equal(rejection.retryable, false);
assert.equal(rejection.outcomeUnknown, false);
assert.equal(rejection.code, "LINKEDIN_PUBLISH_REJECTED");
assert.equal(classifyProviderFailure("INSTAGRAM", "MEDIA_CREATE", 400, false).code, "INSTAGRAM_MEDIA_CREATE_REJECTED");
assert.equal(classifyProviderFailure("INSTAGRAM", "MEDIA_STATUS", 404, false).code, "INSTAGRAM_MEDIA_STATUS_REJECTED");
const preWriteNetwork = classifyProviderFailure("LINKEDIN", "IMAGE_UPLOAD", null, false);
assert.equal(preWriteNetwork.retryable, true);
const visibleTimeout = classifyProviderFailure("FACEBOOK", "PUBLISH", null, true);
assert.equal(visibleTimeout.retryable, false);
assert.equal(visibleTimeout.outcomeUnknown, true);
assert.equal(visibleTimeout.code, "PROVIDER_OUTCOME_UNKNOWN");

const firstDelay = retryDelaySeconds("00000000-0000-4000-8000-000000000001", 1);
const thirdDelay = retryDelaySeconds("00000000-0000-4000-8000-000000000001", 3);
assert.ok(firstDelay >= 300 && firstDelay <= 390);
assert.ok(thirdDelay >= 1200 && thirdDelay <= 1290);

// Customer-visible lifecycle without exposing internals.
assert.match(store, /PROCESSING|state/);
assert.match(store, /next_attempt_at/);
assert.match(store, /published_at/);
assert.match(calendar, /In pubblicazione/);
assert.match(calendar, /Da riprovare/);
assert.match(calendar, /Da verificare sul social/);
assert.match(dashboard, /In pubblicazione/);
assert.doesNotMatch(calendar, /claim_token|lease_expires_at|usage_event_id/);

// Real adapter format matrix: Instagram POST/STORY; Facebook and LinkedIn POST.
assert.match(social, /variant\.format !== "POST" && variant\.format !== "STORY"/);
assert.match(social, /variant\.format === "CAROUSEL"/);
assert.match(social, /FACEBOOK_FORMAT_REQUIRES_ADDITIONAL_MEDIA_ASSETS/);
assert.match(social, /LINKEDIN_FORMAT_NOT_SUPPORTED/);

console.log("FASE 7F publication engine regression: PASS — durable claim, remote boundary, atomic completion, safe retry, metering, tenant-bound media and customer lifecycle.");
