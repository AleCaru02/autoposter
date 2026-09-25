import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import handler from "../api/autopilot.js";
import { AUTOPILOT_PUBLISH_FORMATS, chooseAutopilotContentType, chooseAutopilotPublishFormat } from "../api/_lib/autopilot.js";
import { providerCapabilities } from "../api/_lib/social.js";

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
    assert.match(serializedSource, /profileAiEconomicsPolicy/, "autopilot must retain per-profile operational policy for cadence and image deferral");
    assert.match(serializedSource, /ActivityBudgetEngine/, "autopilot must use the canonical per-activity EUR budget engine");
    assert.match(serializedSource, /budgetEngine\.snapshot\(profileId\)/, "autopilot must read the selected activity budget independently");
    assert.match(serializedSource, /ACTIVITY_HARD_STOP/, "only the activity at 30 EUR must be hard-stopped");
    assert.match(serializedSource, /budgetEngine\.preflight\(\{profileId,task:"STRATEGY"/, "paid planner refresh must pass the same activity budget preflight");
    assert.match(serializedSource, /maxGenerationsPerDay/);
    assert.match(serializedSource, /maxGenerationsPerWeek/);
    assert.match(serializedSource, /policy\.generateImagesAfterApproval===false/, "manual-review profiles must keep the existing defer-image-until-approval policy");
    assert.match(serializedSource, /allowImageGeneration/, "image deferral must be passed explicitly instead of abusing an image quota");
    assert.match(serializedSource, /profile_id=\$1::uuid/, "usage accounting must be profile-isolated");
    assert.match(serializedSource, /strategyPlannerRefreshDecision/, "Autopilot must decide whether Strategist\/Planner refresh is needed before generation");
    assert.match(serializedSource, /ensureOpenAIStrategyPlannerFresh/, "stale Strategy\/Plan must be refreshed through OpenAI before content generation");
    assert.match(serializedSource, /usage=await usageSnapshot\(client,profileId\)/, "daily\/weekly usage must be read again after a paid planning refresh");

    const canonicalAutopilotSource = await readFile(new URL("../api/_lib/autopilot.ts", import.meta.url), "utf8");
    assert.match(canonicalAutopilotSource, /ActivityBudgetEngine/, "canonical autopilot must use the activity budget engine for text and images");
    assert.match(canonicalAutopilotSource, /allowImageGeneration/, "canonical autopilot must preserve approval-aware image deferral");
    assert.match(canonicalAutopilotSource, /task:"COPY_FINAL"/, "text generation must be budget-preflighted");
    assert.match(canonicalAutopilotSource, /task:"IMAGE_STANDARD"/, "image generation must be budget-preflighted");
    assert.doesNotMatch(canonicalAutopilotSource, /textBudget\(|imageLimit\(/, "legacy split text/image budgets must be retired");
    for (const provider of ["INSTAGRAM", "FACEBOOK", "LINKEDIN", "GBP"] as const) {
      assert.deepEqual(AUTOPILOT_PUBLISH_FORMATS[provider], providerCapabilities(provider).publish, `${provider} autopilot formats must match the real publisher`);
    }
    assert.equal(chooseAutopilotPublishFormat("INSTAGRAM", 0, "CAROUSEL"), "POST", "single-asset Instagram carousel plans must fall back safely");
    assert.equal(chooseAutopilotPublishFormat("INSTAGRAM", 1, "CAROUSEL"), "STORY", "Instagram fallback keeps its supported rotation");
    assert.equal(chooseAutopilotPublishFormat("FACEBOOK", 2, "STORY"), "POST");
    assert.equal(chooseAutopilotPublishFormat("LINKEDIN", 3, "CAROUSEL"), "POST");
    assert.equal(chooseAutopilotContentType("POST"), "SINGLE_POST", "normalized single-post publishers must not retain a carousel brief");
    assert.equal(chooseAutopilotContentType("STORY"), "SINGLE_STORY");
    assert.equal(chooseAutopilotContentType("CAROUSEL"), "CAROUSEL");

    const plannerSource = await readFile(new URL("../api/_lib/openai-strategy-planner.ts", import.meta.url), "utf8");
    assert.match(plannerSource, /Facebook, LinkedIn e GBP usa SINGLE_POST/);
    assert.match(plannerSource, /Non pianificare caroselli finché non esiste un bundle reale di più asset/);

    const vercelAutopilotSource = await readFile(new URL("../api/autopilot.ts", import.meta.url), "utf8");
    assert.match(vercelAutopilotSource, /runContentAutopilotSerialized/, "Vercel manual autopilot must use the serialized runner");

    const workerEntrySource = await readFile(new URL("../cloudflare/entry.ts", import.meta.url), "utf8");
    assert.match(workerEntrySource, /const result = await runContentAutopilotSerialized\(env,\s*\{\s*profileId,\s*maxGenerations:\s*6\s*\}\)/, "Worker manual autopilot must remain attached to the authenticated request until generation completes");
    assert.doesNotMatch(workerEntrySource, /ctx\.waitUntil\(runContentAutopilotSerialized\(env,\s*\{\s*profileId/, "manual Autopilot must not be truncated in the post-response waitUntil window");
    assert.match(workerEntrySource, /return json\(result\)/, "manual Autopilot must return its durable result instead of an early 202");
    assert.match(workerEntrySource, /runContentAutopilotSerialized\(env\)/, "Worker scheduled autopilot must use the serialized runner");
    assert.match(workerEntrySource, /path === "\/api\/generate-text"/, "Worker /api/generate-text must be intercepted before the legacy worker handler");
    assert.match(workerEntrySource, /handleWorkerGenerateText\(request,\s*env\)/, "Worker text generation must use the dedupe-aware handler");

    for (const sourcePath of ["../src/pages/content-generator-page.tsx", "../src/components/manual-content-composer.tsx", "../src/pages/approvals-page.tsx", "../src/features/content/content-store.ts"]) {
      const source = await readFile(new URL(sourcePath, import.meta.url), "utf8");
      assert.match(source, /authenticatedApiToken\(\)/, `${sourcePath} must use the canonical Managed Auth token boundary`);
      assert.doesNotMatch(source, /getJWTToken/, `${sourcePath} must not call the unsupported /api/auth/get-jwt-token route`);
    }

    console.log("autopilot route contract: PASS — per-profile economics, zero-image manual review, AI-plan refresh and Worker routes guarded.");
  } finally {
    globalThis.fetch = previousFetch;
  }
}

void run();
