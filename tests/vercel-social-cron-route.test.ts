import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import handler from "../api/cron-social.js";

const config = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
assert.ok(config.crons.some((item: {path?:string;schedule?:string}) => item.path === "/api/cron-social" && item.schedule === "0 * * * *"), "A separate schedule must exist");
const source = readFileSync(new URL("../api/cron-social.ts", import.meta.url), "utf8");
for (const requirement of ["CRON_SECRET", "AUTO_SOCIAL_PUBLISH_ENABLED", "AUTO_SOCIAL_ANALYTICS_ENABLED", "SAFE_MODE", "SOCIAL_TOKEN_KEY", "processDuePublications", "processDueAnalytics"]) {
  assert.ok(source.includes(requirement), "Missing social cron safety requirement " + requirement);
}

const keys = ["CRON_SECRET", "AUTO_SOCIAL_PUBLISH_ENABLED", "AUTO_SOCIAL_ANALYTICS_ENABLED", "DATABASE_URL", "SOCIAL_TOKEN_KEY", "SAFE_MODE"] as const;
const previous = Object.fromEntries(keys.map(k => [k, process.env[k]]));
function response() {
  const snapshot: {code:number;body:unknown} = {code:200,body:null};
  const out = {
    setHeader(_name:string,_value:string) { return out; },
    status(code:number) { snapshot.code=code; return out; },
    json(body:unknown) { snapshot.body=body; return out; },
  };
  return {snapshot,out};
}
function request(secret?:string, method="GET") {
  return {method,headers:{authorization:secret ? `Bearer ${secret}` : undefined}};
}
async function invoke(secret?:string, method="GET") {
  const {snapshot,out}=response();
  await handler(request(secret,method) as never,out as never);
  return snapshot;
}

try {
  process.env.CRON_SECRET="test-secure-cron-secret";
  delete process.env.AUTO_SOCIAL_PUBLISH_ENABLED;
  delete process.env.AUTO_SOCIAL_ANALYTICS_ENABLED;
  delete process.env.DATABASE_URL;
  delete process.env.SOCIAL_TOKEN_KEY;
  delete process.env.SAFE_MODE;

  assert.deepEqual(await invoke(undefined), {code:401,body:{error:"UNAUTHORIZED_CRON"}});
  assert.deepEqual(await invoke("wrong"), {code:401,body:{error:"UNAUTHORIZED_CRON"}});
  assert.deepEqual(await invoke("test-secure-cron-secret","POST"), {code:405,body:{error:"METHOD_NOT_ALLOWED"}});
  const disabled = await invoke("test-secure-cron-secret");
  assert.deepEqual(disabled, {code:200,body:{ok:true,publishing:"DISABLED_CONFIG",analytics:"DISABLED_CONFIG"}});
  process.env.AUTO_SOCIAL_PUBLISH_ENABLED = "true";
  assert.deepEqual(await invoke("test-secure-cron-secret"), {code:503,body:{error:"SOCIAL_SECURITY_NOT_CONFIGURED"}});
  process.env.DATABASE_URL = "postgresql://example.invalid/db";
  process.env.SOCIAL_TOKEN_KEY = "long-test-secret-no-real-provider-token";
  process.env.SAFE_MODE = "true";
  const blocked = await invoke("test-secure-cron-secret");
  assert.equal(blocked.code,200);
  assert.equal((blocked.body as {publishing:string}).publishing,"SAFE_MODE_ACTIVE");
  delete process.env.SAFE_MODE;
  const invalid = await invoke("test-secure-cron-secret");
  assert.equal(invalid.code,200);
  assert.equal((invalid.body as {publishing:string}).publishing,"SAFE_MODE_UNDETERMINED");
  console.log("Vercel opt-in social cron security: PASS (no external writes)");
} finally {
  for (const key of keys) {
    if (previous[key]===undefined) delete process.env[key];
    else process.env[key]=previous[key];
  }
}
