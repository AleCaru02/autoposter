import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync("db/migrations/20260928_personal_brand_sources.sql", "utf8");
const sourceStore = fs.readFileSync("src/features/profiles/personal-brand-source-store.ts", "utf8");
const sourcePanel = fs.readFileSync("src/components/personal-brand-sources-panel.tsx", "utf8");
const sourceApi = fs.readFileSync("cloudflare/personal-brand-sources.ts", "utf8");
const composer = fs.readFileSync("src/components/manual-content-composer.tsx", "utf8");
const manualGeneration = fs.readFileSync("src/features/content/manual-content-generation.ts", "utf8");
const contentStore = fs.readFileSync("src/features/content/content-store.ts", "utf8");
const generateText = fs.readFileSync("api/generate-text.ts", "utf8");
const sourceRuntime = fs.readFileSync("api/_lib/personal-brand-sources.ts", "utf8");
const openaiText = fs.readFileSync("api/_lib/openai-text.ts", "utf8");
const autopilot = fs.readFileSync("api/_lib/autopilot.ts", "utf8");

// Database contract + validation + tenant isolation.
assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.personal_brand_sources/);
assert.match(migration, /UNIQUE \(personal_brand_profile_id, source_profile_id, pillar\)/);
assert.match(migration, /pb_type IS DISTINCT FROM 'PERSONAL_BRAND'/);
assert.match(migration, /source_type IS DISTINCT FROM 'BUSINESS'/);
assert.match(migration, /pb_owner IS NULL OR source_owner IS NULL OR pb_owner IS DISTINCT FROM source_owner/);
assert.match(migration, /source_archived IS NOT NULL/);
assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
assert.match(migration, /FORCE ROW LEVEL SECURITY/);
for (const operation of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
  assert.match(migration, new RegExp(`FOR ${operation} TO authenticated`), `${operation} policy must exist`);
}
assert.match(migration, /owns_profile\(personal_brand_profile_id\)[\s\S]*owns_profile\(source_profile_id\)/);

// CRUD + reload/persistence contract.
assert.match(sourceStore, /\/api\/personal-brand\/sources\?profileId=/, "READ must use authenticated same-origin API");
assert.match(sourceStore, /method: "POST"/, "CREATE must use server API");
assert.match(sourceStore, /method: "DELETE"/, "DELETE must use server API");
assert.match(sourcePanel, /loadPersonalBrandSources\(props\.personalBrandProfileId\)/, "panel must reload persisted source rows");
assert.match(sourcePanel, /savePersonalBrandSource/);
assert.match(sourcePanel, /deletePersonalBrandSource/);
assert.match(sourcePanel, /Dati da altre attività/, "UX must use non-technical wording");
assert.doesNotMatch(sourcePanel, />Pillar</, "technical pillar field must not be exposed");
assert.doesNotMatch(sourcePanel, />Priorità</, "technical priority field must not be exposed");
assert.doesNotMatch(sourcePanel, />Peso</, "technical weight field must not be exposed");
assert.match(sourcePanel, /Non sostituisce le “Informazioni aggiuntive”/, "UX must distinguish source authorization from free-form profile context");

// Same-origin API owns the write contract and verifies both profiles server-side.
assert.match(sourceApi, /owner_auth_user_id=\$\{authUserId\}/);
assert.match(sourceApi, /profile_type='PERSONAL_BRAND'/);
assert.match(sourceApi, /profile_type='BUSINESS'/);
assert.match(sourceApi, /insert into public\.personal_brand_sources/);
assert.match(sourceApi, /delete from public\.personal_brand_sources/);
assert.match(sourceApi, /allowed_topics,allowed_claims,allowed_ctas,asset_policy,weight,priority/);
assert.match(sourceApi, /'REFERENCE_ONLY',1,100/);

// Server-side authorization cannot trust the browser-selected source.
assert.match(sourceRuntime, /where s\.personal_brand_profile_id=\$\{personalBrandProfileId\}::uuid/);
assert.match(sourceRuntime, /source\.owner_auth_user_id=pb\.owner_auth_user_id/);
assert.match(sourceRuntime, /source\.profile_type='BUSINESS'/);
assert.match(sourceRuntime, /pb\.profile_type='PERSONAL_BRAND'/);
assert.match(sourceRuntime, /throw new Error\("PERSONAL_BRAND_SOURCE_NOT_AUTHORIZED"\)/);
assert.match(generateText, /loadEditorialProfile\(sql, profileId, authUserId\)/, "manual API must verify profile ownership server-side");
assert.match(generateText, /resolvePersonalBrandSource\(sql, profileId, requestedSourceProfileId, requestedPillar\)/, "manual API must resolve only authorized source relationships");
assert.match(autopilot, /resolvePersonalBrandSource\(sql,profile\.id\)/, "autopilot must resolve an authorized source server-side");

// Personal Brand identity stays independent; source contributes factual context.
assert.match(sourceRuntime, /loadProfileBrandContext\(sql, personalBrand\)/);
assert.match(sourceRuntime, /loadEditorialProfile\(sql, relation\.source_profile_id, personalBrand\.owner_auth_user_id\)/);
assert.match(sourceRuntime, /confirmedWebsiteContent: source\.brand\.confirmedWebsiteContent/);
assert.match(openaiText, /Mantieni identità, voce, pubblico e obiettivi del Personal Brand/);
assert.match(openaiText, /authorizedSource è una singola attività sorgente esplicitamente autorizzata/);
assert.match(openaiText, /Non attribuire al Personal Brand servizi, sedi o risultati dell'attività come se fossero propri/);

// Manual UI/API use one shared source+pillar contract.
assert.match(composer, /sourceProfileId: selectedSource\?\.source_profile_id \?\? null/);
assert.match(composer, /pillar: selectedSource\?\.pillar \?\? null/);
assert.match(manualGeneration, /sourceProfileId: input\.sourceProfileId \?\? null/);
assert.match(manualGeneration, /pillar: input\.pillar \?\? null/);
assert.match(manualGeneration, /PERSONAL_BRAND_SOURCE_NOT_AUTHORIZED/);
assert.match(manualGeneration, /PERSONAL_BRAND_OBJECTIVE_REQUIRED/);
assert.match(manualGeneration, /PERSONAL_BRAND_AUDIENCE_REQUIRED/);

// Provenance must survive save + reload and DB must reject invalid/mixed sources.
for (const column of ["pillar", "source_profile_id", "source_profile_ids", "source_refs", "audience", "fact_provenance", "editorial_cta", "source_mix_approved"]) {
  assert.match(migration, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}`), `${column} must exist in schema`);
  assert.match(contentStore, new RegExp(column), `${column} must be persisted/reloaded by content store`);
}
assert.match(migration, /PERSONAL_BRAND_CONTENT_PILLAR_REQUIRED/);
assert.match(migration, /PERSONAL_BRAND_CONTENT_OBJECTIVE_REQUIRED/);
assert.match(migration, /PERSONAL_BRAND_CONTENT_CTA_REQUIRED/);
assert.match(migration, /PERSONAL_BRAND_CONTENT_AUDIENCE_REQUIRED/);
assert.match(migration, /PERSONAL_BRAND_SOURCE_MIX_REQUIRES_APPROVAL/);
assert.match(migration, /PERSONAL_BRAND_SOURCE_NOT_AUTHORIZED/);
assert.match(migration, /PERSONAL_BRAND_CONTENT_SOURCES_REQUIRED/);
assert.match(migration, /PERSONAL_BRAND_CONTENT_PROVENANCE_REQUIRED/);
assert.match(contentStore, /\.select\("id,profile_id,topic,objective,title,status,pillar,source_profile_id,source_profile_ids,source_refs,audience,fact_provenance,editorial_cta,source_mix_approved,created_at,updated_at"\)/, "reload must include provenance fields");
assert.match(generateText, /editorialContext:[\s\S]*externalSources: result\.externalSources/);
assert.match(autopilot, /source_refs,audience,fact_provenance,editorial_cta,source_mix_approved/);

console.log("Personal Brand Sources FASE 5 regression: PASS");
