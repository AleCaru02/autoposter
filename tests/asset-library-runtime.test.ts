import assert from "node:assert/strict";
import fs from "node:fs";
import { findReusableAsset, visualFingerprint } from "../api/_lib/asset-intelligence.js";

const visualBrief="ritratto professionale ufficio milano per consulente";
const fingerprint=await visualFingerprint({visualBrief,aspectRatio:"1:1"});
const base = {
  id:"11111111-1111-4111-8111-111111111111",
  source:"USER_UPLOAD",
  kind:"IMAGE",
  name:"Ritratto professionale ufficio Milano",
  storage_url:"data:image/png;base64,AAAA",
  mime_type:"image/png",
  tags:["ritratto","professionale","ufficio","milano"],
  metadata:{aspect_ratio:"1:1",visual_brief:visualBrief,visual_fingerprint:fingerprint},
  created_at:"2026-09-29T10:00:00Z",
};

const blocked = await findReusableAsset({
  visualBrief,
  aspectRatio:"1:1",
  candidates:[{...base,quality_status:"BLOCK"}],
});
assert.equal(blocked,null,"blocked assets must never be reused");

const pass = await findReusableAsset({
  visualBrief,
  aspectRatio:"1:1",
  candidates:[{...base,quality_status:"PASS"}],
});
assert.ok(pass,"quality PASS asset should remain eligible for reuse");

const migration=fs.readFileSync("db/migrations/20260929_zzz_asset_library.sql","utf8");
for(const field of ["content_id","provider","model","cost_eur","width","height","format","quality_status","identity_status","publication_usage","reuse_count","content_hash"]){
  assert.match(migration,new RegExp(field));
}
assert.match(migration,/publication_asset_usage/);
assert.match(migration,/NEW\.state='PUBLISHED'/);
assert.match(migration,/assets_profile_content_hash_uidx/);

const runtime=fs.readFileSync("cloudflare/asset-library.ts","utf8");
assert.match(runtime,/owner_auth_user_id/);
assert.match(runtime,/LINK_TO_VARIANT/);
assert.match(runtime,/quality_status === "BLOCK"/);
assert.match(runtime,/publication_usage/);
assert.match(runtime,/content_hash/);
assert.match(runtime,/USER_UPLOAD/);
assert.match(runtime,/REAL_ASSET/);
assert.doesNotMatch(runtime,/HF_CREDENTIALS|OPENAI_API_KEY|SOCIAL_TOKEN_KEY/);

const autopilot=fs.readFileSync("api/_lib/autopilot.ts","utf8");
assert.match(autopilot,/assetContentHashFromBase64/);
assert.match(autopilot,/reuse_count=reuse_count\+1/);
assert.match(autopilot,/content_id,source,kind,name/);
assert.match(autopilot,/quality_status,identity_status/);

const worker=fs.readFileSync("cloudflare/worker.ts","utf8");
assert.match(worker,/content_hash: contentHash/);
assert.match(worker,/provider: "OPENAI"/);
assert.match(worker,/quality_status: "PENDING"/);

const store=fs.readFileSync("src/features/content/content-store.ts","utf8");
const deleteContent=store.slice(store.indexOf("export async function deleteContent"));
assert.doesNotMatch(deleteContent,/from\("assets"\)\.delete/,"content deletion must keep reusable assets");

const app=fs.readFileSync("src/App.tsx","utf8");
const shell=fs.readFileSync("src/components/app-shell.tsx","utf8");
const assetsPage=fs.readFileSync("src/pages/assets-page.tsx","utf8");
assert.match(app,/path="libreria"/);
assert.match(shell,/\/app\/libreria/);
assert.match(assetsPage,/const availableVariants = useMemo\(\(\) => variants,\[variants\]\);/,"manual recovery must allow replacing an existing pending visual");
assert.doesNotMatch(assetsPage,/variants\.filter\(\(item\)=>!item\.image_asset_id\)/,"pending variants with an existing blocked visual must remain selectable");

console.log("Asset library runtime: PASS");
