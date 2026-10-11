import assert from "node:assert/strict";

const compositor = await import("../api/_lib/deterministic-text-compositor.js");
assert.equal(typeof compositor.preflightDeterministicTypography, "function");
assert.equal(typeof compositor.composeDeterministicTypography, "function");
console.log("Deterministic text compositor Node import boundary: PASS");
