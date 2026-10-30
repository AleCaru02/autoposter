import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  INSTAGRAM_WEBSITE_PILOT_TOPICS,
  instagramWebsitePilotEnabled,
  instagramWebsitePilotTopic,
  instagramWebsitePilotBrief,
} from "../api/_lib/instagram-website-pilot.js";

assert.equal(instagramWebsitePilotEnabled(null), false);
assert.equal(instagramWebsitePilotEnabled({}), false);
assert.equal(instagramWebsitePilotEnabled({ instagramWebsitePilot: "true" }), false);
assert.equal(instagramWebsitePilotEnabled({ instagramWebsitePilot: true }), true);

assert.equal(INSTAGRAM_WEBSITE_PILOT_TOPICS.length, 8);
assert.equal(new Set(INSTAGRAM_WEBSITE_PILOT_TOPICS).size, 8);
assert.equal(instagramWebsitePilotTopic(0), INSTAGRAM_WEBSITE_PILOT_TOPICS[0]);
assert.equal(instagramWebsitePilotTopic(8), INSTAGRAM_WEBSITE_PILOT_TOPICS[0]);
assert.equal(instagramWebsitePilotTopic(-2), INSTAGRAM_WEBSITE_PILOT_TOPICS[0]);
assert.equal(instagramWebsitePilotTopic(Number.NaN), INSTAGRAM_WEBSITE_PILOT_TOPICS[0]);

const brief = instagramWebsitePilotBrief(2);
assert.match(brief, /99 euro al mese/);
assert.match(brief, /bozza iniziale gratuita/);
assert.match(brief, /italiano naturale/);
assert.match(brief, /NON Reel e NON carosello/);
assert.match(brief, /Non inventare testimonianze/);
assert.match(brief, /dichiarati esempi/);

const autopilot = await readFile(new URL("../api/_lib/autopilot.ts", import.meta.url), "utf8");
assert.match(autopilot, /provider==="INSTAGRAM"&&instagramWebsitePilotEnabled/);
assert.match(autopilot, /availableFormats:SocialFormat\[\]=websitePilot\?\["POST"\]/);
assert.match(autopilot, /if\(settings.websitePilot&&schedule.provider!=="INSTAGRAM"\)continue/);
assert.match(autopilot, /settings.websitePilot\?2:21/);
assert.match(autopilot, /approvalMode:settings.websitePilot\?"MANUAL_REVIEW":settings.approvalMode/);
assert.match(autopilot, /const baseTopicRequest=websitePilot\?instagramWebsitePilotBrief\(count\)/);

const serialized = await readFile(new URL("../api/_lib/autopilot-serialized.ts", import.meta.url), "utf8");
assert.match(serialized, /allowImageGeneration=strategyObject.instagramWebsitePilot===true/);
assert.match(serialized, /if\(strategyObject.autopilotEnabled===false\)\{aggregate.profilesChecked\+=1;aggregate.skipped\+=1;continue;\}/);

const store = await readFile(new URL("../src/features/content/autopilot-store.ts", import.meta.url), "utf8");
assert.match(store, /websitePilotEnabled: row.instagramWebsitePilot === true/);
assert.match(store, /instagramWebsitePilot: settings.websitePilotEnabled/);
const page = await readFile(new URL("../src/pages/content-generator-page.tsx", import.meta.url), "utf8");
assert.match(page, /Pilota Instagram · siti web/);
assert.match(page, /approvalMode: "MANUAL_REVIEW"/);
assert.match(page, /enabled: overview.settings.websitePilotEnabled \? overview.settings.enabled : true/);

console.log("PASS Italian Instagram website pilot: opt-in, content brief, format, 2 weekly slots, manual review and profile isolation.");
