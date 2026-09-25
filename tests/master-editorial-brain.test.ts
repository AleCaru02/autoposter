import assert from "node:assert/strict";
import { decideMasterEditorial } from "../api/_lib/master-editorial-brain.js";
const ready = decideMasterEditorial({ topic: "Come preparare un immobile per gli affitti brevi", objective: "Generare richieste", funnelStage: "CONSIDERATION", contentType: "SINGLE_POST", intent: "TIP", preferredProvider: "INSTAGRAM", format: "POST", localBusinessRelevance: true, professionalRelevance: true, hasVerifiableContext: true });
assert.equal(ready.status, "READY"); assert.equal(ready.selectedProvider, "INSTAGRAM"); assert.equal(ready.channels.filter((x) => x.action === "USE").length, 1); assert.equal(ready.channels.find((x) => x.provider === "GBP")?.action, "SKIP");
const skipped = decideMasterEditorial({ topic: "", funnelStage: "AWARENESS", contentType: "SINGLE_POST", intent: "TIP", preferredProvider: "FACEBOOK", format: "POST", localBusinessRelevance: false, professionalRelevance: false, hasVerifiableContext: false });
assert.equal(skipped.status, "SKIP_PUBLICATION"); assert.equal(skipped.channels.every((x) => x.action === "SKIP"), true); console.log("Master Editorial Brain: PASS");
