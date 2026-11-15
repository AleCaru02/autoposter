import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createColdStartFetch, emptyAnswerReason, isRetrySafe } from "../api/_lib/cold-start-fetch.js";

type Call = { url: string; method: string };
function fakeDataApi(answers: Array<{ status: number; body: string }>) {
  const calls: Call[] = [];
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : null;
    calls.push({ url: request ? request.url : String(input), method: (init?.method ?? request?.method ?? "GET").toUpperCase() });
    if (request && request.body) await request.text(); // consume like a real fetch
    const answer = answers[Math.min(calls.length - 1, answers.length - 1)];
    return new Response(answer.body, { status: answer.status, headers: { "content-type": "application/json" } });
  };
  return { fetcher, calls };
}
const noSleep = async () => undefined;
const API = "https://ep-x.apirest.c-5.us-west-2.aws.neon.tech/neondb/rest/v1";
const ROW = '[{"id":"p1"}]';

// 1. Cold start: an empty list is retried once and the real answer is returned.
{
  const { fetcher, calls } = fakeDataApi([{ status: 200, body: "[]" }, { status: 200, body: ROW }]);
  const guarded = createColdStartFetch(fetcher, { sleep: noSleep });
  const response = await guarded(`${API}/profiles?select=id`);
  assert.equal(await response.text(), ROW);
  assert.equal(calls.length, 2, "exactly one retry on a cold empty read");
}

// 2. Warm connection: a genuinely empty list is trusted (no extra latency).
{
  const { fetcher, calls } = fakeDataApi([{ status: 200, body: ROW }, { status: 200, body: "[]" }, { status: 200, body: ROW }]);
  let clock = 1_000;
  const guarded = createColdStartFetch(fetcher, { sleep: noSleep, now: () => clock });
  await guarded(`${API}/profiles?select=id`);
  clock += 30_000;
  assert.equal(await (await guarded(`${API}/content_items?select=id`)).text(), "[]");
  assert.equal(calls.length, 2, "no retry inside the warm window");
  // After the warm window the compute may have slept again: the guard re-arms.
  clock += 300_000;
  const { fetcher: f2, calls: c2 } = fakeDataApi([{ status: 200, body: "[]" }, { status: 200, body: ROW }]);
  const rearmed = createColdStartFetch(f2, { sleep: noSleep, now: () => clock });
  await rearmed(`${API}/content_items?select=id`);
  assert.equal(c2.length, 2);
}

// 3. Never more than one retry, even if the second answer is still empty.
{
  const { fetcher, calls } = fakeDataApi([{ status: 200, body: "[]" }]);
  const guarded = createColdStartFetch(fetcher, { sleep: noSleep });
  assert.equal(await (await guarded(`${API}/content_items?select=id`)).text(), "[]");
  assert.equal(calls.length, 2);
}

// 4. .single() cold answer (406 PGRST116) is retried; other errors are not.
{
  const { fetcher, calls } = fakeDataApi([{ status: 406, body: '{"code":"PGRST116","message":"0 rows"}' }, { status: 200, body: '{"id":"p1"}' }]);
  const guarded = createColdStartFetch(fetcher, { sleep: noSleep });
  const response = await guarded(`${API}/profiles?id=eq.p1`, { headers: { accept: "application/vnd.pgrst.object+json" } });
  assert.equal(response.status, 200);
  assert.equal(calls.length, 2);
  const denied = fakeDataApi([{ status: 401, body: '{"message":"jwt"}' }]);
  await createColdStartFetch(denied.fetcher, { sleep: noSleep })(`${API}/profiles`);
  assert.equal(denied.calls.length, 1, "401 is never retried");
}

// 5. Writes: inserts and write RPCs are never repeated; idempotent PATCH with representation is.
{
  const insert = fakeDataApi([{ status: 201, body: "[]" }]);
  await createColdStartFetch(insert.fetcher, { sleep: noSleep })(`${API}/content_items`, { method: "POST", body: "{}", headers: { prefer: "return=representation" } });
  assert.equal(insert.calls.length, 1);
  const insert200 = fakeDataApi([{ status: 200, body: "[]" }]);
  await createColdStartFetch(insert200.fetcher, { sleep: noSleep })(`${API}/content_items`, { method: "POST", body: "{}" });
  assert.equal(insert200.calls.length, 1, "POST to a table is never retried");
  const writeRpc = fakeDataApi([{ status: 200, body: "null" }]);
  await createColdStartFetch(writeRpc.fetcher, { sleep: noSleep })(`${API}/rpc/save_profile_schedule`, { method: "POST", body: "{}" });
  assert.equal(writeRpc.calls.length, 1, "write RPC is never retried");
  const readRpc = fakeDataApi([{ status: 200, body: "null" }, { status: 200, body: '"user-1"' }]);
  const rpcAnswer = await createColdStartFetch(readRpc.fetcher, { sleep: noSleep })(`${API}/rpc/current_auth_user_id`, { method: "POST", body: "{}" });
  assert.equal(await rpcAnswer.text(), '"user-1"');
  assert.equal(readRpc.calls.length, 2, "allow-listed read RPC is retried");
  const patch = fakeDataApi([{ status: 200, body: "[]" }, { status: 200, body: ROW }]);
  await createColdStartFetch(patch.fetcher, { sleep: noSleep })(`${API}/profiles?id=eq.p1`, { method: "PATCH", body: "{}", headers: { prefer: "return=representation" } });
  assert.equal(patch.calls.length, 2);
  const patchMinimal = fakeDataApi([{ status: 200, body: "[]" }]);
  await createColdStartFetch(patchMinimal.fetcher, { sleep: noSleep })(`${API}/profiles?id=eq.p1`, { method: "PATCH", body: "{}" });
  assert.equal(patchMinimal.calls.length, 1);
  assert.equal(isRetrySafe("HEAD", `${API}/x`, new Headers()), true);
  const head = fakeDataApi([{ status: 200, body: "" }]);
  await createColdStartFetch(head.fetcher, { sleep: noSleep })(`${API}/content_items`, { method: "HEAD" });
  assert.equal(head.calls.length, 1, "HEAD (count) answers have no body and are not treated as empty");
}

// 6. Request objects with a body are replayed safely (body cloned before the first send).
{
  const { fetcher, calls } = fakeDataApi([{ status: 200, body: "null" }, { status: 200, body: '"user-1"' }]);
  const guarded = createColdStartFetch(fetcher, { sleep: noSleep });
  const response = await guarded(new Request(`${API}/rpc/current_auth_user_id`, { method: "POST", body: "{}" }));
  assert.equal(await response.text(), '"user-1"');
  assert.equal(calls.length, 2);
}

// 7. Shapes.
assert.equal(await emptyAnswerReason(new Response("[]", { status: 200 })), "EMPTY_ARRAY");
assert.equal(await emptyAnswerReason(new Response("[{}]", { status: 200 })), null);
assert.equal(await emptyAnswerReason(new Response(null, { status: 204 })), null);

// 8. Every Data API caller goes through the shared guard (no raw fetch left).
{
  const sources = [
    "api/ai-budget-recommendation.ts", "api/autopilot.ts", "api/editorial-agents.ts", "api/generate-image.ts", "api/generate-text.ts",
    "api/learning.ts", "api/onboarding-analyze.ts", "api/website-scan.ts", "api/_lib/social.ts", "api/_lib/verified-customer-auth.ts",
    "api/render.ts", "api/profile-bootstrap.ts", "api/avatar.ts",
    "cloudflare/editorial-agents.ts", "cloudflare/entry.ts", "cloudflare/generate-text.ts", "cloudflare/onboarding-analyze.ts", "cloudflare/platform-rbac.ts", "cloudflare/worker.ts",
  ];
  for (const file of sources) {
    const text = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(text, /[^a-zA-Z]fetch\(`\$\{(DATA_API|NEON_PROFILES_DATA_API)\}/, `${file} uses the shared guard`);
  }
  const client = readFileSync(new URL("../src/lib/neon-client.ts", import.meta.url), "utf8");
  assert.match(client, /options: \{ global: \{ fetch: dataApiFetch \} \}/, "browser Data API client uses the guard");
  const settings = readFileSync(new URL("../src/pages/settings-page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(settings, /await fetch\(`\$\{NEON_DATA_API_URL\}/);
}

console.log("PASS cold-start fetch: 1 solo retry controllato su letture/PATCH idempotenti/RPC di sola lettura, mai su insert o RPC di scrittura, finestra calda senza latenza, tutte le chiamate Data API (browser, Vercel, Worker) passano dal meccanismo condiviso.");
