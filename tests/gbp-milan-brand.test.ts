import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  isMilanPropertyDailyGbpProfile,
  milanPropertyGbpBrandContext,
  milanPropertyGbpVisualIdentity,
  MILAN_PROPERTY_GBP_EDITORIAL_GUIDE,
} from "../api/_lib/gbp-milan-property-brand.js";
import { normalizeBrandVisualIdentity } from "../api/_lib/brand-visual-identity.js";
import type { BrandContext } from "../api/_lib/openai-text.js";

const id = "73486d3c-dca0-4aaa-a69e-d4b08cc6430f";
assert.equal(isMilanPropertyDailyGbpProfile(id,id,"GBP"),true);
assert.equal(isMilanPropertyDailyGbpProfile(id,undefined,"GBP"),false);
assert.equal(isMilanPropertyDailyGbpProfile(id,id,"INSTAGRAM"),false);
assert.equal(isMilanPropertyDailyGbpProfile("different",id,"GBP"),false);
assert.match(MILAN_PROPERTY_GBP_EDITORIAL_GUIDE,/Valuta il tuo immobile/);
assert.match(MILAN_PROPERTY_GBP_EDITORIAL_GUIDE,/rendimenti/);

const basicBrand: BrandContext = {
  profileName: "Il Tuo Property Manager",
  industry: "Property Management", websiteUrl: "https://iltuopropertymanager.it",
  description: "Gestione affitti brevi", businessModel:null,location:"Milano",
  serviceArea:"Milano",target:"Proprietari",tone:null,goals:[],
  userContext:null, confirmedWebsiteContent:[{url:"https://iltuopropertymanager.it",title:"Home",text:"Valutazione preliminare dell'immobile"}],
};
const updated = milanPropertyGbpBrandContext(basicBrand);
assert.match(updated.profileName,/Alessandro Caruso/);
assert.match(updated.tone??"",/Professionale/);
assert.equal(updated.confirmedWebsiteContent,basicBrand.confirmedWebsiteContent);
const kit=milanPropertyGbpVisualIdentity({brandKitApproved:true,logoAssetId:"e023697c-c8af-4988-8f4e-ddb8780688b5",observedColors:["#17324d","#c9923d"]});
assert.equal(kit.brandKitApproved,true);
assert.equal(kit.logoAssetId,"e023697c-c8af-4988-8f4e-ddb8780688b5");
const social=normalizeBrandVisualIdentity(kit,"Property Management");
assert.equal(social.activeSocialPalette.source,"OBSERVED");
assert.equal(social.activeSocialPalette.primary,"#1B7E50");
assert.equal(social.activeSocialPalette.secondary,"#15171A");
assert.equal(social.activeSocialPalette.neutral,"#FFFFFF");
assert.deepEqual(social.fonts,["Plus Jakarta Sans"]);

const cron=readFileSync("api/cron-gbp-daily.ts","utf8");
const runner=readFileSync("api/_lib/autopilot.ts","utf8");
assert.match(cron,/GBP_DAILY_PROFILE_ID:scope.profileId/);
assert.match(runner,/milanPropertyGbpBrandContext\(loaded.context\)/);
assert.match(runner,/milanPropertyGbpVisualIdentity\(loaded.visualIdentity\)/);
assert.match(runner,/enforceSiteBrand\?MILAN_PROPERTY_GBP_EDITORIAL_GUIDE:null/);
console.log("GBP website visual and personal-brand enforcement: PASS");
