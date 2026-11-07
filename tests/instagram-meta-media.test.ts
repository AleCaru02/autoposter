import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  assertInstagramCaption, instagramCarouselChildForm, instagramCarouselParentForm,
  validateInstagramCarousel, validateInstagramPublishImage,
  type InstagramPublishImage,
} from "../api/_lib/instagram-media.js";

const slide = (index: number): InstagramPublishImage => ({
  position:index,
  asset_id:`asset-${index}`,
  mime_type:"image/jpeg",
  width:1080,height:1080,
  qa_status:"PASS",
  asset_quality_status:"PASS",
  asset_identity_status:"NOT_REQUIRED",
});
const ready = [slide(1),slide(2),slide(3),slide(4)];
assert.deepEqual(validateInstagramCarousel(ready),["asset-1","asset-2","asset-3","asset-4"]);
assert.equal(validateInstagramPublishImage(slide(1)),null);
assert.equal(validateInstagramPublishImage({...slide(1),mime_type:"image/png"}),"INSTAGRAM_ASSET_JPEG_REQUIRED");
assert.equal(validateInstagramPublishImage({...slide(1),width:null}),"INSTAGRAM_ASSET_DIMENSIONS_REQUIRED");
assert.equal(validateInstagramPublishImage({...slide(1),qa_status:"PENDING"}),"INSTAGRAM_ASSET_QA_NOT_APPROVED");
assert.equal(validateInstagramPublishImage({...slide(1),asset_quality_status:"PENDING"}),"INSTAGRAM_ASSET_QUALITY_NOT_APPROVED");
assert.equal(validateInstagramPublishImage({...slide(1),asset_identity_status:"BLOCK"}),"INSTAGRAM_ASSET_IDENTITY_NOT_APPROVED");
assert.equal(validateInstagramPublishImage({...slide(1),width:500,height:1200}),"INSTAGRAM_ASSET_ASPECT_RATIO_UNSUPPORTED");
assert.equal(validateInstagramPublishImage({...slide(1),width:1080,height:1920},"STORY"),null);
assert.equal(validateInstagramPublishImage({...slide(1),width:1080,height:1920},"POST"),"INSTAGRAM_ASSET_ASPECT_RATIO_UNSUPPORTED");
assert.throws(()=>validateInstagramCarousel(ready.slice(0,3)),/SLIDE_COUNT/);
assert.throws(()=>validateInstagramCarousel([...ready.slice(0,3),{...slide(4),position:8}]),/SLIDE_ORDER/);
assert.throws(()=>validateInstagramCarousel([...ready.slice(0,3),{...slide(4),asset_id:"asset-2"}]),/DUPLICATE_IMAGE/);
assert.throws(()=>validateInstagramCarousel([...ready.slice(0,3),{...slide(4),width:1080,height:1350}]),/MIXED_ASPECT_RATIOS/);
assert.throws(()=>validateInstagramCarousel([...ready.slice(0,3),{...slide(4),mime_type:"image/png"}]),/JPEG_REQUIRED/);
assert.doesNotThrow(()=>assertInstagramCaption("Una caption valida"));
assert.throws(()=>assertInstagramCaption("a".repeat(2201)),/CAPTION_TOO_LONG/);
assert.throws(()=>assertInstagramCaption("   "),/CAPTION_EMPTY/);
const child=instagramCarouselChildForm("https://example.test/photo.jpg","TOKEN","Alt image");
assert.equal(child.get("is_carousel_item"),"true");
assert.equal(child.get("alt_text"),"Alt image");
assert.equal(child.has("caption"),false);
const parent=instagramCarouselParentForm(["123","456","789","101"],"Testo", "TOKEN");
assert.equal(parent.get("media_type"),"CAROUSEL");
assert.equal(parent.get("children"),"123,456,789,101");
assert.equal(parent.get("caption"),"Testo");
assert.throws(()=>instagramCarouselParentForm(["x","2","3","4"],"Testo","TOKEN"),/IDS_INVALID/);

const social=readFileSync(new URL("../api/_lib/social.ts",import.meta.url),"utf8");
assert.match(social,/publishInstagramCarousel/);
assert.match(social,/validateInstagramCarousel\(slides\)/);
assert.match(social,/beforeVisibleWrite/);
assert.match(readFileSync(new URL("../api/_lib/instagram-media.ts",import.meta.url),"utf8"),/is_carousel_item/);
assert.match(social,/validateInstagramPublishImage/);
assert.match(social,/JPEG_MEDIA_INVALID/);
assert.match(social,/childContainerIds/);
assert.match(social,/where s\.profile_id=\$\{variant\.profile_id\}/);
const store=readFileSync(new URL("../src/features/content/content-store.ts",import.meta.url),"utf8");
assert.match(store,/width,height,format,quality_status,identity_status/);
console.log("Instagram Meta media: PASS — JPEG format, carousel sequence, asset isolation and publishing boundary.");
