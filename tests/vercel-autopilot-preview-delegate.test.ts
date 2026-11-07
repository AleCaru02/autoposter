import assert from "node:assert/strict";
import handler, { canDelegatePreviewAutopilot } from "../api/autopilot.js";
import { readFileSync } from "node:fs";

const preview = "post-automatici-canonical-git-fea-5b851e-ales-projects-b8ec22ac.vercel.app";
const profileId = "41a3cf82-8ebd-453f-a16c-8402c97e16f5";

assert.equal(canDelegatePreviewAutopilot({
  vercelEnv: "preview", gitRef: "feature/instagram-creator-toolkit-20261107",
  configuredPreviewOrigin: `https://${preview}`, requestHost: preview,
}), true);
for (const unsafe of [
  { vercelEnv: "production", gitRef: "feature/instagram-creator-toolkit-20261107", configuredPreviewOrigin: `https://${preview}`, requestHost: preview },
  { vercelEnv: "preview", gitRef: "main", configuredPreviewOrigin: `https://${preview}`, requestHost: preview },
  { vercelEnv: "preview", gitRef: "feature/instagram-creator-toolkit-20261107", configuredPreviewOrigin: `https://${preview}`, requestHost: "example.org" },
  { vercelEnv: "preview", gitRef: "feature/instagram-creator-toolkit-20261107", configuredPreviewOrigin: "https://example.org", requestHost: preview },
]) assert.equal(canDelegatePreviewAutopilot(unsafe), false);

const old = {
  VERCEL_ENV: process.env.VERCEL_ENV,
  VERCEL_GIT_COMMIT_REF: process.env.VERCEL_GIT_COMMIT_REF,
  AUTH_PREVIEW_ORIGIN: process.env.AUTH_PREVIEW_ORIGIN,
  DATABASE_URL: process.env.DATABASE_URL,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
};
const previousFetch = globalThis.fetch;
let delegated = 0;
function fakeRes() {
  let statusCode = 200, payload: unknown = null;
  return {
    status(code:number) { statusCode = code; return this; },
    json(body:unknown) { payload = body; return this; },
    setHeader(_name:string,_value:string) {},
    get code(){return statusCode;},
    get body(){return payload;},
  };
}
try {
  process.env.VERCEL_ENV="preview";
  process.env.VERCEL_GIT_COMMIT_REF="feature/instagram-creator-toolkit-20261107";
  process.env.AUTH_PREVIEW_ORIGIN=`https://${preview}`;
  delete process.env.DATABASE_URL;
  delete process.env.OPENAI_API_KEY;
  globalThis.fetch=(async (url, init) => {
    const requestUrl=String(url);
    if (requestUrl.includes("/profiles?")) {
      assert.equal(init?.headers && (init.headers as Record<string,string>).authorization, "Bearer user-jwt");
      return new Response(JSON.stringify([{id:profileId}]),{status:200,headers:{"content-type":"application/json"}});
    }
    if (requestUrl === "https://post-automatici-canonical.vercel.app/api/autopilot/run") {
      delegated++;
      assert.equal(init?.method, "POST");
      assert.equal((init?.headers as Record<string,string>).authorization, "Bearer user-jwt");
      assert.deepEqual(JSON.parse(String(init?.body)), {profileId});
      return new Response(JSON.stringify({profilesChecked:1,generated:1,blockedForReview:1,errors:[]}),{status:200,headers:{"content-type":"application/json"}});
    }
    throw new Error("Unexpected outbound request");
  }) as typeof fetch;
  const req={query:{path:"run"},headers:{authorization:"Bearer user-jwt",host:preview},method:"POST",body:{profileId}};
  const valid=fakeRes();
  await handler(req as never,valid as never);
  assert.equal(valid.code,200);
  assert.equal((valid.body as {generated:number}).generated,1);
  assert.equal(delegated,1);
  const unapprovedHost=fakeRes();
  await handler({...req,headers:{...req.headers,host:"other.example"}} as never,unapprovedHost as never);
  assert.equal(unapprovedHost.code,503);
  assert.equal(delegated,1);
  const forbiddenProfile=fakeRes();
  await handler({...req,body:{profileId:"00000000-0000-4000-8000-000000000001"}} as never,forbiddenProfile as never);
  assert.equal(forbiddenProfile.code,404);
  assert.equal(delegated,1);
} finally {
  globalThis.fetch=previousFetch;
  for (const [key,value] of Object.entries(old)) {
    if(value===undefined)delete process.env[key as keyof NodeJS.ProcessEnv];
    else process.env[key as keyof NodeJS.ProcessEnv]=value;
  }
}
const page=readFileSync(new URL("../src/pages/content-generator-page.tsx",import.meta.url),"utf8");
assert.match(page,/AutopilotRunResponse/);
assert.match(page,/autopilotFailureMessage/);
assert.ok(page.includes("Generazione in corso"));
assert.equal(page.includes("Autopilot non avviato. Riprova tra poco."),false,"No generic error concealing server capability");
console.log("Preview canonical autopilot delegate and truthful execution feedback: PASS");
