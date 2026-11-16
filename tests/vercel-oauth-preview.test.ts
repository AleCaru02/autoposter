import assert from "node:assert/strict";
import handler from "../api/oauth/complete.js";
import { APP_ORIGIN } from "../api/auth.js";

const preview = "https://post-automatici-canonical-git-fea-5b851e-ales-projects-b8ec22ac.vercel.app";

function invoke(host: string, query: Record<string, string> = {}) {
  const state: {status: number;headers: Record<string, unknown>;body: unknown} = {status: 200,headers:{},body:null};
  const res = {
    setHeader(name: string, value: unknown) {state.headers[name.toLowerCase()]=value;return res;},
    status(code: number) {state.status=code;return res;},
    json(body: unknown) {state.body=body;return res;},
    send(body: unknown) {state.body=body;return res;},
  };
  return handler({method:"GET",headers:{host},query} as never,res as never).then(() => state);
}

const previous = {vercel:process.env.VERCEL_ENV,origin:process.env.AUTH_PREVIEW_ORIGIN};
try {
  process.env.VERCEL_ENV="preview";
  process.env.AUTH_PREVIEW_ORIGIN=preview;
  const expected=await invoke(new URL(preview).host);
  assert.equal(expected.status,302);
  assert.equal(expected.headers.location,preview+"/login?oauth=missing_verifier");
  const error=await invoke(new URL(preview).host,{error:"access_denied"});
  assert.equal(error.headers.location,preview+"/login?oauth=provider_access_denied");
  const denied=await invoke("attacker.vercel.app");
  assert.equal(denied.status,403);
  const production=await invoke(new URL(APP_ORIGIN).host);
  assert.equal(production.status,302);
  assert.equal(production.headers.location,APP_ORIGIN+"/login?oauth=missing_verifier");
  process.env.VERCEL_ENV="production";
  const disabled=await invoke(new URL(preview).host);
  assert.equal(disabled.status,403);
  console.log("Google OAuth preview callback host isolation: PASS");
} finally {
  if(previous.vercel===undefined)delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV=previous.vercel;
  if(previous.origin===undefined)delete process.env.AUTH_PREVIEW_ORIGIN; else process.env.AUTH_PREVIEW_ORIGIN=previous.origin;
}
