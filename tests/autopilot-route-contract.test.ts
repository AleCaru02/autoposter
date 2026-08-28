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

    console.log("autopilot route contract: PASS");
  } finally {
    globalThis.fetch = previousFetch;
  }
}

void run();
