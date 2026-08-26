import assert from "node:assert/strict";
import { deriveContentStatus, normalizeHashtags, parseHashtagInput, variantKey } from "../src/features/content/content-workflow.js";

assert.equal(deriveContentStatus([]), "IN_REVIEW");
assert.equal(deriveContentStatus(["PENDING"]), "IN_REVIEW");
assert.equal(deriveContentStatus(["APPROVED", "PENDING"]), "IN_REVIEW");
assert.equal(deriveContentStatus(["APPROVED", "APPROVED"]), "APPROVED");
assert.equal(deriveContentStatus(["APPROVED", "CHANGES_REQUESTED"]), "CHANGES_REQUESTED");
assert.equal(deriveContentStatus(["PENDING", "CHANGES_REQUESTED"]), "CHANGES_REQUESTED");

assert.deepEqual(normalizeHashtags([" #uno ", "", 12, "#due"]), ["#uno", "#due"]);
assert.deepEqual(parseHashtagInput("uno #due,tre"), ["#uno", "#due", "#tre"]);
assert.equal(variantKey("INSTAGRAM", "POST", 0), "INSTAGRAM-POST-0");

console.log("PASS content workflow: stati approvazione coerenti, modifiche riapribili e hashtag normalizzati.");
