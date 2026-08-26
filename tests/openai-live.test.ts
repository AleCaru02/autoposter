import assert from "node:assert/strict";
import { generateSocialText } from "../api/_lib/openai-text.js";

const apiKey = process.env.OPENAI_API_KEY?.trim();
if (!apiKey) {
  console.log("SKIP OpenAI live: OPENAI_API_KEY non configurata nei GitHub Actions secrets.");
  process.exit(0);
}

const result = await generateSocialText({
  apiKey,
  topic: "Presentare in modo professionale un servizio di gestione attività",
  objective: "notorietà",
  providers: ["LINKEDIN"],
  formats: ["POST"],
  brand: {
    profileName: "Post Automatici QA",
    industry: "Servizi",
    websiteUrl: null,
    description: "Servizio professionale per attività locali.",
    businessModel: "Servizi B2B",
    location: "Milano",
    serviceArea: "Milano",
    target: "Titolari di attività",
    tone: "Professionale, chiaro e concreto",
    goals: ["notorietà"],
    confirmedWebsiteContent: [],
  },
});

assert.equal(result.model, "gpt-5.6-terra");
assert.ok(result.responseId.startsWith("resp_"));
assert.ok(result.content.variants.length >= 1);
assert.equal(result.content.variants[0].provider, "LINKEDIN");
console.log(`PASS OpenAI live: ${result.model}, response ricevuta, structured output valido.`);
