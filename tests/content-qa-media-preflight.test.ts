import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { contentQaMediaPreflight } from "../api/_lib/content-qa.js";

const media = [{ id: "asset-1", width: 1080, height: 1350 }];
const post = { format: "POST" as const, image_asset_id: "asset-1" };
const slides = [
  { position: 1, asset_id: "asset-1" },
  { position: 2, asset_id: "asset-1" },
  { position: 3, asset_id: "asset-1" },
  { position: 4, asset_id: "asset-1" },
];

assert.equal(contentQaMediaPreflight(post, [], media), null, "valid image must reach real visual QA");
assert.equal(contentQaMediaPreflight({ ...post, image_asset_id: null }, [], media), "CONTENT_QA_IMAGE_REQUIRED");
assert.equal(contentQaMediaPreflight({ ...post, image_asset_id: "missing" }, [], media), "CONTENT_QA_IMAGE_REQUIRED");
assert.equal(contentQaMediaPreflight(post, [], [{ ...media[0], width: 0 }]), "CONTENT_QA_MEDIA_DIMENSIONS_INVALID");
assert.equal(contentQaMediaPreflight({ format: "CAROUSEL", image_asset_id: null }, slides, media), null);
assert.equal(contentQaMediaPreflight({ format: "CAROUSEL", image_asset_id: null }, slides.slice(0, 3), media), "CONTENT_QA_CAROUSEL_INCOMPLETE");
assert.equal(contentQaMediaPreflight({ format: "CAROUSEL", image_asset_id: null }, [{ ...slides[0], asset_id: null }, ...slides.slice(1)], media), "CONTENT_QA_CAROUSEL_ASSET_REQUIRED");
assert.equal(contentQaMediaPreflight({ format: "CAROUSEL", image_asset_id: null }, [{ ...slides[0], position: 2 }, ...slides.slice(1)], media), "CONTENT_QA_CAROUSEL_ASSET_REQUIRED");

const qaSource = readFileSync(new URL("../api/_lib/content-qa.ts", import.meta.url), "utf8");
const beforeCharge = qaSource.indexOf("const mediaProblem = contentQaMediaPreflight(variant, slides, assets)");
const quota = qaSource.indexOf("const usage = new EntitlementUsageService(input.databaseUrl)", beforeCharge);
const reserve = qaSource.indexOf("await usage.reserveUsage(", beforeCharge);
assert.ok(beforeCharge >= 0 && quota > beforeCharge && reserve > quota, "no AI entitlement or budget may be reserved before media readiness");
assert.match(qaSource, /if \(mediaProblem\) throw new Error\(mediaProblem\)/);
const endpoint = readFileSync(new URL("../cloudflare/content-qa.ts", import.meta.url), "utf8");
assert.match(endpoint, /CONTENT_QA_IMAGE_REQUIRED/);
console.log("Content QA zero-cost media preflight: PASS");
