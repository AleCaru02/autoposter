import assert from "node:assert/strict";
import { estimateInformationDensity, selectAutonomousFormat } from "../api/_lib/format-selection.js";
import type { EditorialMemorySnapshot } from "../api/_lib/editorial-memory.js";

const memory: EditorialMemorySnapshot = {
  version:1,
  profileType:"BUSINESS",
  builtAt:new Date(0).toISOString(),
  sourceContentCount:8,
  recent:{
    topics:[],hooks:[],ctas:[],pillars:[],
    formats:[{value:"POST",count:6},{value:"STORY",count:1}],
    visualArchetypes:[],subjects:[],productsOrServices:[],sources:[],
  },
  balance:{strategyPillars:[],underusedPillars:[],overusedPillars:[]},
  continuity:{activeSeries:[],suggestedNextTopicIntent:null},
  feedback:{weightedSignals:[],recentNotes:[]},
  calendar:{futureCount:2,providers:[],formats:[{value:"POST",count:2}]},
  learning:[],
};

assert.equal(estimateInformationDensity({topic:"5 differenze tra Airbnb e Booking",objective:"spiega commissioni, cancellazioni, pagamenti e gestione"}),"HIGH");
assert.equal(estimateInformationDensity({topic:"Dietro le quinte dell'evento",objective:"momento rapido"}),"LOW");

const idealCarousel = selectAutonomousFormat({
  provider:"INSTAGRAM",
  topic:"5 differenze tra Airbnb e Booking",
  objective:"guida educativa con cinque punti",
  supportedFormats:["POST","STORY","CAROUSEL"],
  memory,
});
assert.equal(idealCarousel.preferredFormat,"CAROUSEL");
assert.equal(idealCarousel.selectedFormat,"CAROUSEL");
assert.equal(idealCarousel.capabilityConstrained,false);

const runtimeConstrained = selectAutonomousFormat({
  provider:"INSTAGRAM",
  topic:"5 differenze tra Airbnb e Booking",
  objective:"guida educativa con cinque punti",
  supportedFormats:["POST","STORY"],
  memory,
});
assert.equal(runtimeConstrained.preferredFormat,"CAROUSEL");
assert.notEqual(runtimeConstrained.selectedFormat,"CAROUSEL");
assert.equal(runtimeConstrained.capabilityConstrained,true);
assert.match(runtimeConstrained.reasons.join(" "),/runtime provider non lo supporta/i);

const gbp = selectAutonomousFormat({
  provider:"GBP",
  topic:"Aggiornamento del servizio locale",
  objective:"informare e invitare al contatto",
  supportedFormats:["POST"],
  requestedFormat:"CAROUSEL",
});
assert.equal(gbp.selectedFormat,"POST");
assert.equal(gbp.capabilityConstrained,gbp.preferredFormat!=="POST");

const learned = selectAutonomousFormat({
  provider:"INSTAGRAM",
  topic:"Novità breve dal team",
  objective:"engagement",
  supportedFormats:["POST","STORY"],
  learnedFormat:"STORY",
});
assert.equal(learned.selectedFormat,"STORY");

console.log("PASS format selection: density + platform + memory + learning + capability.");
