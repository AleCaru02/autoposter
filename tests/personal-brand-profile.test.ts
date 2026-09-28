import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync("db/migrations/20260928_personal_brand_first_class.sql", "utf8");
const provisioning = readFileSync("api/_lib/onboarding-provisioning.ts", "utf8");
const bootstrap = readFileSync("api/_lib/profile-bootstrap.ts", "utf8");
const context = readFileSync("src/features/profiles/profile-context.tsx", "utf8");
const onboarding = readFileSync("src/pages/onboarding-page.tsx", "utf8");
const profiles = readFileSync("src/pages/profiles-page.tsx", "utf8");

assert.match(migration, /ADD COLUMN IF NOT EXISTS profile_type text NOT NULL DEFAULT 'BUSINESS'/, "existing profiles must remain BUSINESS by default");
assert.match(migration, /CHECK \(profile_type IN \('BUSINESS','PERSONAL_BRAND'\)\)/, "profile type must be constrained server-side");
assert.match(migration, /p_profile_type text/, "provisioning must persist an explicit profile type");
assert.match(migration, /INSERT INTO public\.profiles\([\s\S]*profile_type/, "profile type must be stored in profiles");
assert.match(migration, /ONBOARDING_PROFILE_TYPE_INVALID/, "invalid profile types must fail closed");
assert.match(migration, /REVOKE ALL ON FUNCTION public\.provision_onboarding_profile\(text,uuid,text,text,text,text,text,text\)/, "privileged provisioning overload must not be customer-callable");

assert.match(provisioning, /export type ProfileType = "BUSINESS" \| "PERSONAL_BRAND"/);
assert.match(provisioning, /profileType: resolvedProfileType/, "idempotency fingerprint must include profile type");
assert.match(provisioning, /\$\{websiteUrl\}, \$\{industry\}, \$\{resolvedProfileType\}/, "server call must pass the profile type to SQL");
assert.match(bootstrap, /p\.profile_type/, "bootstrap must return persisted profile type");
assert.match(context, /profile_type: ProfileType/, "client profile model must keep profile type");
assert.match(context, /profileType: input\.profileType \?\? "BUSINESS"/, "business must remain the backwards-compatible default");
assert.match(onboarding, /value="PERSONAL_BRAND"/, "onboarding must let the user create a real Personal Brand");
assert.match(onboarding, /createProfile\(\{ name, websiteUrl: website, industry, profileType \}\)/, "selected type must reach provisioning");
assert.match(onboarding, /identità, voce, pubblico, obiettivi, strategia, calendario e apprendimento propri/, "Personal Brand UI must explain its independent editorial identity");
assert.match(profiles, /profile\.profile_type === "PERSONAL_BRAND"/, "profile list must distinguish Personal Brand from business");

console.log("Personal Brand first-class profile: PASS");

