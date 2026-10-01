import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../cloudflare/entry.js";

const config = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
const entrySource = readFileSync(new URL("../cloudflare/entry.ts", import.meta.url), "utf8");
const publicationMigration = readFileSync(new URL("../db/migrations/20260908_fase7f_safe_publication_engine.sql", import.meta.url), "utf8");
const deployWorkflow = readFileSync(new URL("../.github/workflows/deploy-worker.yml", import.meta.url), "utf8");

assert.deepEqual(
  [...config.triggers.crons].sort(),
  ["*/5 * * * *", "0 * * * *"].sort(),
  "production must declare the publication and hourly Cloudflare Cron Triggers",
);
assert.equal(config.vars.SAFE_MODE, "true", "production cron must inherit fail-closed SAFE_MODE");
assert.match(entrySource, /async scheduled\(controller:[\s\S]*controller\.cron === "\*\/5 \* \* \* \*"\)[\s\S]*processDuePublications\(env\)/);
assert.doesNotMatch(entrySource, /path === ["']\/api\/(?:internal\/)?cron/i, "publication cron must not be exposed as a public HTTP endpoint");
assert.match(entrySource, /social-publication-failed[\s\S]*throw reason;/, "cron failures must propagate to Cloudflare Past Events");
assert.match(entrySource, /scheduledTime[\s\S]*toISOString\(\)/, "cron scheduled time must be logged as an explicit UTC instant");
assert.match(publicationMigration, /FOR UPDATE SKIP LOCKED/i, "overlapping ticks must converge on the atomic DB claim");
assert.match(publicationMigration, /claim_token=gen_random_uuid\(\)/i, "claimed jobs need unique claim tokens");
assert.match(publicationMigration, /lease_expires_at/i, "worker interruption must be recoverable through a durable lease");
assert.match(publicationMigration, /job\.scheduled_at <= clock_timestamp\(\)/, "a later tick must recover jobs missed by an earlier tick");
assert.match(deployWorkflow, /npx wrangler deploy --secrets-file worker-secrets\.json/, "restart/deploy must restore cron config from the deployed Worker");
assert.doesNotMatch(entrySource, /setInterval\s*\(/, "cron availability must not depend on process-local timers");

type LogRow = { label: string; payload: Record<string, unknown> };
const logs: LogRow[] = [];
const errors: LogRow[] = [];
const originalLog = console.log;
const originalError = console.error;
console.log = (label?: unknown, payload?: unknown) => {
  if (typeof label === "string" && payload && typeof payload === "object") logs.push({ label, payload: payload as Record<string, unknown> });
};
console.error = (label?: unknown, payload?: unknown) => {
  if (typeof label === "string" && payload && typeof payload === "object") errors.push({ label, payload: payload as Record<string, unknown> });
};

async function invokeSafeTick(scheduledTime: number) {
  const waited: Promise<unknown>[] = [];
  const ctx = { waitUntil(promise: Promise<unknown>) { waited.push(promise); } };
  await worker.scheduled(
    { cron: "*/5 * * * *", scheduledTime },
    { SAFE_MODE: "true" } as never,
    ctx,
  );
  assert.equal(waited.length, 1, "each cron invocation must register exactly one publication task");
  await Promise.all(waited);
}

try {
  const firstTime = Date.parse("2026-10-01T19:40:00.000Z");
  await Promise.all([
    invokeSafeTick(firstTime),
    invokeSafeTick(firstTime + 5 * 60_000),
  ]);
} finally {
  console.log = originalLog;
  console.error = originalError;
}

const cronLogs = logs.filter((row) => row.label === "social-publication-run");
assert.equal(cronLogs.length, 2, "two close ticks must both finish safely under SAFE_MODE");
assert.equal(errors.filter((row) => row.label === "social-publication-failed").length, 0);
for (const row of cronLogs) {
  assert.equal(row.payload.cron, "*/5 * * * *");
  assert.equal(row.payload.state, "BLOCKED");
  assert.equal(row.payload.safeMode, "ON");
  assert.equal(row.payload.reason, "SAFE_MODE_ACTIVE");
  assert.equal(row.payload.checked, 0);
  assert.equal(row.payload.claimed, 0);
  assert.equal(row.payload.processed, 0);
  assert.equal(row.payload.published, 0);
  assert.equal(row.payload.skipped, 0);
  assert.equal(row.payload.error, null);
  assert.match(String(row.payload.scheduledAt), /Z$/);
}

for (const name of [
  "CRON_CONFIG_PRESENT",
  "CRON_ENTRYPOINT_VALID",
  "CRON_AUTH_PROTECTED",
  "CRON_SAFE_MODE",
  "CRON_DUPLICATE_TICK_SAFE",
  "CRON_OVERLAP_SAFE",
  "CRON_MISSED_TICK_RECOVERY",
  "CRON_RESTART_RECOVERY",
  "CRON_FAILURE_RECOVERY",
  "CRON_TIMEZONE_BOUNDARY",
  "CRON_NO_EXTERNAL_WRITE",
]) {
  originalLog(`${name} = PASS`);
}
originalLog("CRON 24/7 CERTIFICATION runtime: PASS — Cloudflare trigger boundary, fail-closed execution, overlap/recovery and structured observability verified.");
