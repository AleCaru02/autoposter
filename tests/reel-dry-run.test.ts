import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createDryRunReelRuntime, dryRunAllowed, dryRunScript } from "../api/_lib/reel/reel-dry-run.js";
import { validateReelScript, type ReelSource } from "../api/_lib/reel/reel-script.js";

const qa = { NEON_DATA_API_URL: "https://ep-fragrant-mud-ara6ysty.apirest.c-4.us-west-2.aws.neon.tech/neondb/rest/v1", NEON_AUTH_URL: "https://ep-fragrant-mud-ara6ysty.neonauth.c-4.us-west-2.aws.neon.tech/neondb/auth" };
assert.equal(dryRunAllowed({ VERCEL_ENV: "preview", ...qa }), true);
assert.equal(dryRunAllowed({ VERCEL_ENV: "production", ...qa }), false, "never in production");
assert.equal(dryRunAllowed({ VERCEL_ENV: "preview" }), false, "never on a preview wired to the production database");
assert.equal(dryRunAllowed({}), false);
for (const key of ["VERCEL_ENV", "NEON_DATA_API_URL", "NEON_AUTH_URL"]) delete process.env[key];
assert.throws(() => createDryRunReelRuntime({ DATABASE_URL: "postgres://x", BLOB_READ_WRITE_TOKEN: "x" }), /REEL_DRY_RUN_NOT_ALLOWED/);

// Real-shaped source (Il Tuo Property Manager, QA copy): the deterministic script must pass the same guards as an AI script.
const source: ReelSource = {
  profileName: "Il Tuo Property Manager", industry: "Property management e affitti brevi", tone: null,
  topic: "Checklist per preparare il confronto tra affitto breve, medio termine e 4+4 a Milano",
  hook: "Prima di scegliere la formula locativa, apri una cartella. Non un portale.",
  caption: "Prima di confrontare affitto breve, medio termine e 4+4, metti in ordine i documenti dell'immobile. Raccogli planimetria, spese condominiali e vincoli del regolamento. Segna le date in cui vuoi poter usare la casa. Solo dopo ha senso confrontare le formule. Se vuoi, ti aiutiamo con una valutazione gratuita.",
  cta: "Richiedi una valutazione gratuita", visualBrief: null,
};
const script = dryRunScript(source);
assert.deepEqual(validateReelScript(script, source), [], "the dry-run script passes the anti-fabrication and duration guards");
assert.ok(script.caption.startsWith("[PROVA A SECCO"), "dry-run output is labelled");
assert.ok(script.scenes.every((scene) => source.hook!.includes(scene.voiceover) || source.caption!.includes(scene.voiceover)), "voiceover is taken verbatim from the source");

const route = readFileSync(new URL("../api/render.ts", import.meta.url), "utf8");
assert.match(route, /if \(dryRun && !dryRunAllowed\(\)\) return res\.status\(403\)/);
assert.match(route, /job\.dry_run\s*\? createDryRunReelRuntime/);
const jobs = readFileSync(new URL("../api/_lib/reel/render-jobs.ts", import.meta.url), "utf8");
assert.match(jobs, /'REEL',\$\{!job\.dry_run\}/, "dry-run REEL variants are never eligible for scheduling");
const dry = readFileSync(new URL("../api/_lib/reel/reel-dry-run.ts", import.meta.url), "utf8");
assert.doesNotMatch(dry, /openai|OPENAI_API_KEY|generateRoutedImage|synthesizeNarration|CapabilityMeter/i, "the dry-run runtime cannot reach a paid provider");
console.log("PASS reel dry run: solo preview isolata, script fedele alla fonte, nessun provider a pagamento, varianti non pianificabili.");
