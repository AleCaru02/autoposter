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
    assert.match(serializedSource, /pg_advisory_lock/, "autopilot runs must acquire a PostgreSQL advisory lock");
    assert.match(serializedSource, /pg_advisory_unlock/, "autopilot runs must release a PostgreSQL advisory lock");
    assert.match(serializedSource, /runContentAutopilot\(scopedEnv,\s*\{\s*profileId,\s*maxGenerations:\s*profileGenerationCap\s*\}\)/, "serialized wrapper must execute canonical autopilot one profile at a time");
    assert.match(serializedSource, /profileAiEconomicsPolicy/, "autopilot must load per-profile AI economics policy before generation");
    assert.match(serializedSource, /usage\.profileTotalUsd\s*>=\s*policy\.monthlyAiBudgetUsd/, "autopilot must hard-block a profile at its monthly AI limit");
    assert.match(serializedSource, /maxGenerationsPerDay/);
    assert.match(serializedSource, /maxGenerationsPerWeek/);
    assert.match(serializedSource, /policy\.generateImagesAfterApproval\s*===\s*false/, "manual-review profiles must be able to defer image spend until approval");
    assert.match(serializedSource, /profile_id=\$1::uuid/, "usage accounting must be profile-isolated");
    assert.match(serializedSource, /strategyPlannerRefreshDecision/, "Autopilot must decide whether Strategist\/Planner refresh is needed before generation");
    assert.match(serializedSource, /ensureOpenAIStrategyPlannerFresh/, "stale Strategy\/Plan must be refreshed through OpenAI before content generation");
    assert.match(serializedSource, /PLANNER_REFRESH_RESERVE/, "planning refresh must reserve budget before making OpenAI calls");
    assert.match(serializedSource, /usage=await usageSnapshot\(client,profileId\)/, "usage must be read again after a paid planning refresh");

    const canonicalAutopilotSource = await readFile(new URL("../api/_lib/autopilot.ts", import.meta.url), "utf8");
    assert.match(canonicalAutopilotSource, /Math\.min\(Math\.max\(Math\.floor\(parsed\),0\),500\)/, "a scoped zero image allowance must stay zero; manual review must not silently spend one image");
    assert.match(canonicalAutopilotSource, /budget\.imagesUsed<budget\.imageLimit/, "image generation must remain gated by the scoped image allowance");

    const vercelAutopilotSource = await readFile(new URL("../api/autopilot.ts", import.meta.url), "utf8");
    assert.match(vercelAutopilotSource, /runContentAutopilotSerialized/, "Vercel manual autopilot must use the serialized runner");

    const workerEntrySource = await readFile(new URL("../cloudflare/entry.ts", import.meta.url), "utf8");
    assert.match(workerEntrySource, /runContentAutopilotSerialized\(env,\s*\{\s*profileId,\s*maxGenerations:\s*6\s*\}\)/, "Worker manual autopilot must use the serialized runner");
    assert.match(workerEntrySource, /runContentAutopilotSerialized\(env\)/, "Worker scheduled autopilot must use the serialized runner");
    assert.match(workerEntrySource, /path === "\/api\/generate-text"/, "Worker /api/generate-text must be intercepted before the legacy worker handler");
    assert.match(workerEntrySource, /handleWorkerGenerateText\(request,\s*env\)/, "Worker text generation must use the dedupe-aware handler");

    console.log("autopilot route contract: PASS — per-profile economics, zero-image manual review, AI-plan refresh and Worker routes guarded.");
  } finally {
    globalThis.fetch = previousFetch;
  }
}

void run();
