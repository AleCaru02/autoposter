import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../api/_lib/autopilot.ts", import.meta.url), "utf8");
const start = source.indexOf("export async function runContentAutopilot(");
assert.ok(start >= 0, "autopilot runner must exist");
const runner = source.slice(start);
assert.match(runner, /from public\.profiles[\s\S]*and exists \(select 1 from public\.social_connections connected/, "automatic cron must select only profiles with a connected social channel");
assert.match(runner, /connected\.token_reference is not null/, "a merely ACTIVE row with no token cannot cause paid AI work");
assert.match(runner, /connected\.provider_account_id is not null/, "provider account destination is required");
assert.match(runner, /length\(trim\(connected\.provider_account_id\)\)>0/, "blank social account ID fails closed");
assert.match(runner, /connected\.provider=\x27GBP\x27 or connected\.expires_at is null or connected\.expires_at>now\(\)/, "expired non-GBP access tokens cannot trigger paid generation; GBP can refresh");
assert.match(runner, /connected\.last_validated_at >= now\(\)-interval '48 hours'/, "never trust stale/unverified connections");
assert.match(runner, /connected\.provider=public\.schedules\.provider/, "only the connected provider can receive generated content");
assert.match(runner, /Boolean\(options\.profileId\)/, "explicit authenticated manual profile runs must retain draft creation");
assert.match(runner, /result\.generated>=maxGenerations/, "existing maxGenerations must still bound AI spends");
assert.match(source, /runContentQa\(/, "autopilot must keep final QA before auto approval");
assert.match(source, /finalQa\.overallStatus==="PASS"/, "only passing QA can auto-approve");
console.log("autopilot connected-channel preflight: PASS");
