import assert from "node:assert/strict";
import { buildEditorialDecisionRecord } from "../api/_lib/editorial-decision-record.js";
const reused = buildEditorialDecisionRecord({ topic: "Casa luminosa", objective: "ottenere richieste di visita", provider: "INSTAGRAM", format: "POST", eligible: true, approvalStatus: "PENDING", asset: { source: "AI_IMAGE", metadata: { reuse_reason: "EXACT_VISUAL_FINGERPRINT" } } });
assert.match(reused.summary, /richieste di visita/); assert.match(reused.entries.find((entry) => entry.label === "Visuale")!.detail, /riutilizzato/); assert.equal(reused.entries.find((entry) => entry.label === "Visuale")!.state, "PASS"); assert.equal(reused.entries.find((entry) => entry.label === "Controllo")!.state, "REVIEW");
const approved = buildEditorialDecisionRecord({ topic: "Consiglio locale", provider: "GBP", format: "POST", eligible: true, approvalStatus: "APPROVED" });
assert.equal(approved.entries.find((entry) => entry.label === "Controllo")!.state, "PASS"); assert.match(approved.entries.find((entry) => entry.label === "Visuale")!.detail, /Nessun asset/); console.log("Editorial Decision Record: PASS");
