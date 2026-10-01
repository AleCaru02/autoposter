import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { finalizeVisualQa, runOpenAIVisualQa } from "../api/_lib/openai-visual-qa.js";

const [migration,runtime,endpoint,prepublish,entry,store,page,worker,vercelImage,factcheck,editorial] = await Promise.all([
  readFile("db/migrations/20260930_content_qa.sql","utf8"),
  readFile("api/_lib/content-qa.ts","utf8"),
  readFile("cloudflare/content-qa.ts","utf8"),
  readFile("cloudflare/prepublish-qa.ts","utf8"),
  readFile("cloudflare/entry.ts","utf8"),
  readFile("src/features/content/content-store.ts","utf8"),
  readFile("src/pages/approvals-page.tsx","utf8"),
  readFile("cloudflare/worker.ts","utf8"),
  readFile("api/generate-image.ts","utf8"),
  readFile("api/_lib/openai-research-factcheck.ts","utf8"),
  readFile("api/_lib/openai-editorial-qa.ts","utf8"),
]);

for (const field of ["brand_status","copy_status","visual_status","fact_status","platform_status","duplicate_status","budget_status"]) {
  assert.match(migration,new RegExp(field),`structured QA must persist ${field}`);
}
assert.match(migration,/content_qa_results/);
assert.match(migration,/content_variants_qa_invalidation/);
assert.match(migration,/content_carousel_slides_qa_invalidation/);
assert.match(migration,/CONTENT_QA_PASS_REQUIRED/);
assert.match(migration,/CONTENT_ASSET_QA_PASS_REQUIRED/);
assert.match(migration,/s\.qa_status='PASS'/);
assert.match(migration,/a\.quality_status='PASS'/);
assert.match(migration,/a\.identity_status IN \('NOT_REQUIRED','PASS'\)/);
assert.match(migration,/FORCE ROW LEVEL SECURITY/);

for (const symbol of ["runOpenAIEditorialQA","runOpenAIFactCheckAgent","runOpenAIVisualQa","findNearDuplicate","ActivityBudgetEngine"]) {
  assert.match(runtime,new RegExp(symbol),`Content QA must execute ${symbol}`);
}
for (const field of ["slideNumber","copyStatus","visualStatus","factStatus","brandStatus","qualityStatus","reason"]) {
  assert.match(runtime,new RegExp(field),`carousel slide QA must expose ${field}`);
}
assert.match(runtime,/claimType === "EXTERNAL"/);
assert.match(runtime,/sourceRequired/);
assert.match(runtime,/NEEDS_SOURCE/);
assert.match(runtime,/costBucket:"OTHER_AI"/);
assert.match(runtime,/identityStatus\(profile\.profile_type/);
assert.match(runtime,/content\.qa\.run/);
assert.match(runtime,/normalizeBrandVisualIdentity/);
assert.match(runtime,/brandColors:brandVisual\.colors/);
assert.match(runtime,/brandFonts:brandVisual\.fonts/);
assert.match(runtime,/brandVisualStyle:brandVisual\.visualStyle/);

assert.match(endpoint,/verifiedCustomerAuthUserId/);
assert.match(endpoint,/actorType: "MANUAL"/);
assert.match(prepublish,/PREPUBLISH_QA_TOKEN/);
assert.match(prepublish,/socialSafeModeState\(env\)!=="ON"/);
assert.match(prepublish,/j\.state='BLOCKED_APPROVAL'/);
assert.match(prepublish,/j\.attempt_count=0/);
assert.match(prepublish,/v\.approval_mode='MANUAL'/);
assert.match(prepublish,/v\.approval_status='PENDING'/);
assert.match(prepublish,/actorType:"SYSTEM"/);
assert.match(prepublish,/force:true/);
assert.match(prepublish,/REGENERATE_VISUAL_AND_QA/);
assert.match(prepublish,/SAFE_VISUAL_VERSION/);
assert.match(prepublish,/https:\/\/api\.openai\.com\/v1\/images\/generations/);
assert.match(prepublish,/model:"gpt-image-2"/);
assert.match(prepublish,/ActivityBudgetEngine/);
assert.match(prepublish,/ImageGenerationMetering/);
assert.match(prepublish,/persistTechnicalEvents/);
assert.match(prepublish,/runContentQa/);
assert.match(prepublish,/approval_status='PENDING'/);
assert.match(prepublish,/approved_by is null/);
assert.match(prepublish,/external_post_id is null/);
assert.match(prepublish,/result\.model!=="gpt-image-2"/);
assert.match(prepublish,/NON usare mappe, cartografia, planimetrie, percorsi/);
assert.match(prepublish,/quality_status,identity_status/);
assert.match(prepublish,/,'PENDING','NOT_REQUIRED',/);
assert.match(entry,/\/api\/internal\/prepublish-qa/);
assert.ok(entry.indexOf('path === "/api/content-qa"') < entry.indexOf("return worker.fetch(request, env)"),"canonical Worker must route QA before asset fallback");
assert.match(store,/runVariantQa/);
assert.match(page,/variant\.qa_status !== "PASS"/);
assert.match(page,/Content QA/);
assert.match(page,/Esegui QA/);

assert.match(worker,/carouselSlideId/);
assert.match(worker,/content_carousel_slides/);
assert.match(worker,/CAROUSEL_SLIDE_IMAGE_LINK/);
assert.match(vercelImage,/carouselSlideId/);
assert.match(vercelImage,/CAROUSEL_SLIDE_IMAGE_LINK/);
assert.match(vercelImage,/select=tone_of_voice,visual_identity/);
assert.match(vercelImage,/normalizeBrandVisualIdentity/);
assert.match(vercelImage,/generation_prompt/);
assert.match(vercelImage,/brand_palette/);
assert.match(vercelImage,/forceNewImage/);
assert.match(vercelImage,/forceNewImage \? null : await findReusableAsset/);
assert.match(page,/forceNewImage: Boolean\(variant\.image_asset_id\)/);
assert.match(page,/forceNewImage: Boolean\(slide\.asset_id\)/);
assert.match(page,/generateCarouselSlideImage/);
assert.match(page,/Genera visuale slide/);

assert.match(factcheck,/claimType/);
assert.match(factcheck,/EDITORIAL/);
assert.match(factcheck,/NOT_FACTUAL/);
assert.match(factcheck,/verdict=NEEDS_SOURCE/);
assert.match(editorial,/copyQuality/);
assert.match(editorial,/grammar/);
assert.match(editorial,/hashtagFit/);
assert.match(editorial,/slideChecks/);

const pass = finalizeVisualQa({
  briefMatch:.95,composition:.95,technicalQuality:.95,socialFormat:.95,brandSafety:.98,textSafety:.98,
  editorialQuality:.94,genericTemplate:.95,stockLike:.96,textDensity:.94,decorativeUsefulness:.93,
},"ok");
assert.equal(pass.verdict,"PASS");
const fail = finalizeVisualQa({
  briefMatch:.95,composition:.95,technicalQuality:.5,socialFormat:.95,brandSafety:.98,textSafety:.98,
  editorialQuality:.94,genericTemplate:.95,stockLike:.96,textDensity:.94,decorativeUsefulness:.93,
},"artefatti");
assert.equal(fail.verdict,"FAIL");
assert.equal(fail.checks.technicalQuality,"FAIL");

let requestBody: Record<string,any>|null=null;
const visual = await runOpenAIVisualQa({
  apiKey:"test-only",
  imageUrl:"data:image/png;base64,AAAA",
  profileName:"Brand test",
  industry:"Servizi",
  provider:"INSTAGRAM",
  format:"POST",
  visualBrief:"Interno professionale e ordinato",
  altText:"Interno ordinato",
  brandColors:["#112233","#F5F1E8"],
  brandFonts:["Inter"],
  brandVisualStyle:"Minimal premium",
  fetcher:(async (_url:string|URL|Request,init?:RequestInit)=>{
    requestBody=JSON.parse(String(init?.body??"{}"));
    return new Response(JSON.stringify({
      id:"resp_visual_qa",
      model:"gpt-5.6-terra",
      output_text:JSON.stringify({scores:{briefMatch:.95,composition:.95,technicalQuality:.95,socialFormat:.95,brandSafety:.98,textSafety:.98,editorialQuality:.95,genericTemplate:.95,stockLike:.95,textDensity:.95,decorativeUsefulness:.95},reason:"coerente"}),
      usage:{input_tokens:100,output_tokens:40,total_tokens:140},
    }),{status:200,headers:{"x-request-id":"req_visual_qa"}});
  }) as typeof fetch,
});
assert.equal(visual.verdict,"PASS");
assert.equal(requestBody?.input?.[0]?.content?.[1]?.type,"input_image");
const visualQaContext=JSON.parse(String(requestBody?.input?.[0]?.content?.[0]?.text??"{}"));
assert.deepEqual(visualQaContext.brandIdentity.colors,["#112233","#F5F1E8"]);
assert.deepEqual(visualQaContext.brandIdentity.fonts,["Inter"]);
assert.equal(visualQaContext.brandIdentity.visualStyle,"Minimal premium");
assert.match(String(requestBody?.instructions),/mappe, linee metro, percorsi/i);
assert.match(String(requestBody?.instructions),/microcopy|mini-label|pseudo-dati/i);
assert.match(String(requestBody?.instructions),/STRATEGIA VISUAL Instagram/);
assert.match(String(requestBody?.instructions),/fermare lo scroll/i);
assert.match(String(requestBody?.instructions),/genericTemplate/);
assert.match(String(requestBody?.instructions),/stockLike/);
assert.match(String(requestBody?.instructions),/titolo enorme/i);
assert.match(String(requestBody?.instructions),/decorativeUsefulness/);
assert.equal(requestBody?.store,false);

const genericFail=finalizeVisualQa({
  briefMatch:.95,composition:.9,technicalQuality:.95,socialFormat:.95,brandSafety:.98,textSafety:.98,
  editorialQuality:.62,genericTemplate:.5,stockLike:.95,textDensity:.55,decorativeUsefulness:.5,
},"template vuoto con numeri e icone");
assert.equal(genericFail.verdict,"FAIL");
assert.equal(genericFail.checks.genericTemplate,"FAIL");
assert.equal(genericFail.checks.editorialQuality,"FAIL");

console.log("Content QA regression: PASS — structured global/slide QA, factual classification, visual inspection, budget and fail-closed approval.");
