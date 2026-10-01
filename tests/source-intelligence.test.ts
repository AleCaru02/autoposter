import assert from "node:assert/strict";
import {
  buildSourceIntelligence,
  buildSourceRecords,
  hasCriticalUnsupportedClaim,
  normalizeExternalSourceUrl,
} from "../api/_lib/source-intelligence.js";

const normalized = normalizeExternalSourceUrl("https://www.booking.com/content/how_we_work.html?aid=304142&utm_source=test&sid=abc");
assert.equal(normalized?.canonicalUrl, "https://www.booking.com/content/how_we_work.html");
assert.equal(normalized?.trackingRemoved, true);

const records = buildSourceRecords("Airbnb vs Booking differenze", [
  "https://www.airbnb.com/help/article/1604?utm_source=foo",
  "https://www.airbnb.com/help/article/1604",
  "https://www.booking.com/content/how_we_work.html?aid=304142&sid=abc",
  "https://image.email.partnerships.booking.com/lib/file.pdf",
  "https://www.reddit.com/r/airbnb/comments/example",
]);
assert.equal(records.filter((row)=>row.canonicalUrl.includes("airbnb.com/help/article/1604")).length, 1, "canonical URL dedupe must collapse tracking variants");
assert.equal(records.find((row)=>row.host==="airbnb.com")?.tier, "HELP_CENTER");
assert.equal(records.find((row)=>row.host==="image.email.partnerships.booking.com")?.weak, true);
assert.equal(records.find((row)=>row.host==="reddit.com")?.weak, true);

const intelligence = buildSourceIntelligence({
  topic:"Airbnb vs Booking differenze",
  sources:[
    "https://www.airbnb.com/help/article/1604",
    "https://www.airbnb.com/help/article/1857",
    "https://www.airbnb.com/help/article/3164",
    "https://www.airbnb.com/help/article/125",
    "https://www.booking.com/content/how_we_work.html?aid=123",
    "https://www.booking.com/content/how_we_work.html?aid=456",
    "https://image.email.partnerships.booking.com/lib/marketing.pdf",
  ],
  checkedClaims:[
    {claim:"Airbnb applica una determinata struttura di commissioni",sourceRequired:true,status:"VERIFIED"},
    {claim:"Booking.com applica condizioni diverse",sourceRequired:true,status:"VERIFIED"},
  ],
  checkedAt:"2026-10-01T10:00:00.000Z",
});
assert.ok(intelligence.auditSources.length >= 4);
assert.ok(intelligence.uiSources.length <= 8);
assert.ok(intelligence.uiSources.every((row)=>!row.weak));
assert.ok(intelligence.claims.every((claim)=>claim.verificationStatus==="VERIFIED"));
assert.ok(intelligence.claims.every((claim)=>claim.sourceUrls.length > 0));
assert.equal(hasCriticalUnsupportedClaim(intelligence), false);

const blocked = buildSourceIntelligence({
  topic:"Claim senza fonte",
  sources:[],
  checkedClaims:[{claim:"Dato non supportato",sourceRequired:true,status:"UNSUPPORTED"}],
  checkedAt:"2026-10-01T10:00:00.000Z",
});
assert.equal(blocked.claims[0].verificationStatus,"NEEDS_SOURCE");
assert.equal(hasCriticalUnsupportedClaim(blocked), true);

console.log("PASS source intelligence: normalization ranking dedupe weak filter claim mapping and UI cap.");
