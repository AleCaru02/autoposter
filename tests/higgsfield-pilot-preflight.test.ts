import assert from "node:assert/strict";
import {authorizePilotVideo,PILOT_VIDEO_REQUEST} from "../api/_lib/higgsfield-pilot-preflight.js";
assert.equal(PILOT_VIDEO_REQUEST.observedCredits,15);
const base={creditToEur:.04,quotedCredits:15,monthCommittedEur:20,otherReservedEur:2,
 durableReservationConfirmed:true,quoteFresh:true,explicitSpendApproval:true};
assert.equal(authorizePilotVideo(base).authorized,true);
assert.equal(authorizePilotVideo({...base,creditToEur:0}).reason,"UNVERIFIED_CREDIT_VALUE");
assert.equal(authorizePilotVideo({...base,monthCommittedEur:30}).reason,"MONTHLY_CAP_EXCEEDED");
assert.equal(authorizePilotVideo({...base,quoteFresh:false}).reason,"STALE_QUOTE");
assert.equal(authorizePilotVideo({...base,durableReservationConfirmed:false}).reason,"NO_DURABLE_RESERVATION");
assert.equal(authorizePilotVideo({...base,explicitSpendApproval:false}).reason,"SPEND_NOT_APPROVED");
console.log("Higgsfield pilot preflight passed");
