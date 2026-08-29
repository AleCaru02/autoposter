import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import handler from "../api/autopilot.js";

type Captured = { status: number; body: unknown };

function responseCapture() {
  const captured: Captured = { status: 200, body: null };
  const response = {
    status(code: number) { captured.status = code; return response; },
    json(body: unknown) { captured.body = body; return response; },
  };
  return { response, captured };
}

async function run() {
  const previousFetch = globalThis.fetch;
  try {
    {
      const { response, captured } = responseCapture();
      await handler({ method: "POST", headers: {}, query: { path: "run" }, body: { profileId: "00000000-0000-4000-8000-000000000001" } } as never, response as never);
      assert.equal(captured.status, 401);
      assert.deepEqual(captured.body, { error: "AUTH_REQUIRED" });
    }

    globalThis.fetch = async () => new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } });
    {
      const { response, captured } = responseCapture();
      await handler({ method: "POST", headers: { authorization: "Bearer test-token" }, query: { path: "run" }, body: { profileId: "00000000-0000-4000-8000-000000000001" } } as never, response as never);
      assert.equal(captured.status, 404);
      assert.deepEqual(captured.body, { error: "PROFILE_NOT_FOUND" });
    }

    {
      const { response, captured } = responseCapture();
      await handler({ method: "POST", headers: {}, query: { path: "unknown" }, body: {} } as never, response as never);
      assert.equal(captured.status, 404);
      assert.deepEqual(captured.body, { error: "AUTOPILOT_ROUTE_NOT_FOUND" });
    }

    const vercelConfig = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8")) as { rewrites?: Array<{ source?: string; destination?: string }> };
    assert.equal(vercelConfig.rewrites?.some((rewrite) => rewrite.source === "/api/autopilot/:path*" && rewrite.destination === "/api/autopilot?path=:path*"), true, "Vercel must route /api/autopilot/run to the server handler");

    const serializedSource = await readFile(new URL("../api/_lib/autopilot-serialized.ts", import.meta.url), "utf8");
    assert.ok(serializedSource.includes("pg_advisory_lock"), "autopilot runs must acquire a PostgreSQL advisory lock");
    assert.ok(serializedSource.includes("pg_advisory_unlock"), "autopilot runs must release a PostgreSQL advisory lock");
    assert.ok(serializedSource.includes("runContentAutopilot(scopedEnv, { profileId, maxGenerations: profileGenerationCap })"), "serialized wrapper must execute canonical autopilot one profile at a time");
    assert.ok(serializedSource.includes("profileAiEconomicsPolicy"), "autopilot must load per-profile AI economics policy before generation");
    assert.ok(serializedSource.includes("profileTotalUsd >= policy.monthlyAiBudgetUsd"), "autopilot must hard-block a profile at its monthly AI limit");
    assert.ok(serializedSource.includes("maxGenerationsPerDay") && serializedSource.includes("maxGenerationsPerWeek"), "autopilot must enforce per-profile daily and weekly generation caps");
    assert.ok(serializedSource.includes("policy.generateImagesAfterApproval === false"), "manual-review profiles must be able to defer image spend until approval");
    assert.ok(serializedSource.includes("profile_id=$1::uuid"), "usage accounting must be profile-isolated");

    const vercelAutopilotSource = await readFile(new URL("../api/autopilot.ts", import.meta.url), "utf8");
    assert.ok(vercelAutopilotSource.includes("runContentAutopilotSerialized"), "Vercel manual autopilot must use the serialized runner");

    const workerEntrySource = await readFile(new URL("../cloudflare/entry.ts", import.meta.url), "utf8");
    assert.ok(workerEntrySource.includes("runContentAutopilotSerialized(env, { profileId, maxGenerations: 6 })"), "Worker manual autopilot must use the serialized runner");
    assert.ok(workerEntrySource.includes("runContentAutopilotSerialized(env)"), "Worker scheduled autopilot must use the serialized runner");
    assert.ok(workerEntrySource.includes('path === "/api/generate-text"'), "Worker /api/generate-text must be intercepted before the legacy worker handler");
    assert.ok(workerEntrySource.includes("handleWorkerGenerateText(request, env)"), "Worker text generation must use the dedupe-aware handler");

    console.log("autopilot route contract: PASS — serialized, profile-isolated economics guard and Worker text dedupe route guarded.");
  } finally {
    globalThis.fetch = previousFetch;
  }
}

void run();
