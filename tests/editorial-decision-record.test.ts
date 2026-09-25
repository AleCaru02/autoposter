import assert from "node:assert/strict";
import { buildEditorialDecisionRecord } from "../api/_lib/editorial-decision-record.js";
const reused = buildEditorialDecisionRecord({ topic: "Casa luminosa", objective: "ottenere richieste di visita", provider: "INSTAGRAM", format: "POST", eligible: true, approvalStatus: "PENDING", asset: { source: "AI_IMAGE", metadata: { reuse_reason: "EXACT_VISUAL_FINGERPRINT" } } });
assert.match(reused.summary, /richieste di visita/); assert.match(reused.entries[2].detail, /riutilizzato/); assert.equal(reused.entries[2].state, "PASS"); assert.equal(reused.entries[3].state, "REVIEW");
const approved = buildEditorialDecisionRecord({ topic: "Consiglio locale", provider: "GBP", format: "POST", eligible: true, approvalStatus: "APPROVED" });
assert.equal(approved.entries[3].state, "PASS"); assert.match(approved.entries[2].detail, /Nessun asset/); console.log("Editorial Decision Record: PASS");
