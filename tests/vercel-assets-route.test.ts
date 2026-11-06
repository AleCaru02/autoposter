import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import handler from "../api/assets.js";

const source = readFileSync(new URL("../api/assets.ts", import.meta.url), "utf8");
assert.match(source, /handleAssetLibrary/);
assert.match(source, /DATABASE_URL: process\.env\.DATABASE_URL/);
assert.match(source, /authorization|webHeaders/);
assert.match(source, /Buffer\.from\(await response\.arrayBuffer\(\)\)/);
assert.doesNotMatch(source, /service.role|service_role|admin_secret/i);

function capture() {
  const result: { status: number; headers: Record<string, string>; body: any } = { status: 200, headers: {}, body: null };
  const res = {
    status(n: number) { result.status = n; return res; },
    json(data: unknown) { result.body = data; return res; },
    send(data: unknown) { result.body = data; return res; },
    setHeader(key: string, val: string) { result.headers[key.toLowerCase()] = val; return res; },
  };
  return { result, res };
}
const oldDb = process.env.DATABASE_URL;
delete process.env.DATABASE_URL;
try {
  let c = capture();
  await handler({ method: "PATCH", url: "/api/assets", headers: {} } as never, c.res as never);
  assert.equal(c.result.status, 405);
  c = capture();
  await handler({ method: "GET", url: "/api/assets?profileId=00000000-0000-4000-8000-000000000001", headers: {} } as never, c.res as never);
  assert.equal(c.result.status, 503);
  assert.equal(JSON.parse(Buffer.from(c.result.body).toString("utf8")).error, "DATABASE_NOT_CONFIGURED");
  assert.equal(c.result.headers["cache-control"], "no-store");
  console.log("Vercel assets route: PASS (shared handler, fail closed, binary response)");
} finally {
  if (oldDb !== undefined) process.env.DATABASE_URL = oldDb;
}
