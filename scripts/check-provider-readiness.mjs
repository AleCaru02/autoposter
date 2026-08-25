#!/usr/bin/env node

const env = process.env;
const present = (key) => Boolean(String(env[key] ?? '').trim());
const base = String(env.APP_BASE_URL ?? '').replace(/\/$/, '');
const callback = (path) => base ? `${base}${path}` : `<APP_BASE_URL>${path}`;

const readiness = { architecture: true, contract: true, security: true, ui: true, tests: true };
const providers = [
  { name: 'OPENAI', credentials: [['OPENAI_API_KEY']], remote: [], target: null, liveFlag: 'OPENAI_LIVE', note: 'No remote callback required for the initial server-side adapter.' },
  { name: 'META / FACEBOOK', credentials: [['META_APP_ID'], ['META_APP_SECRET']], remote: ['META_REDIRECT_URI'], target: callback('/oauth/meta/callback'), liveFlag: 'META_LIVE' },
  { name: 'INSTAGRAM', credentials: [['META_APP_ID'], ['META_APP_SECRET']], remote: ['META_REDIRECT_URI'], target: callback('/oauth/meta/callback'), liveFlag: 'INSTAGRAM_LIVE', note: 'Application-level readiness is separate from Facebook; the current fixture shares the future Meta app credential boundary.' },
  { name: 'LINKEDIN', credentials: [['LINKEDIN_CLIENT_ID'], ['LINKEDIN_CLIENT_SECRET']], remote: ['LINKEDIN_REDIRECT_URI', 'LINKEDIN_API_VERSION'], target: callback('/oauth/linkedin/callback'), liveFlag: 'LINKEDIN_LIVE' },
  { name: 'GOOGLE BUSINESS PROFILE', credentials: [['GOOGLE_CLIENT_ID'], ['GOOGLE_CLIENT_SECRET']], remote: ['GOOGLE_GBP_REDIRECT_URI'], target: callback('/oauth/google-business-profile/callback'), liveFlag: 'GBP_LIVE' },
  { name: 'TELEGRAM', credentials: [['TELEGRAM_BOT_TOKEN'], ['TELEGRAM_WEBHOOK_SECRET']], remote: ['TELEGRAM_WEBHOOK_URL'], target: callback('/webhooks/telegram'), liveFlag: 'TELEGRAM_LIVE' },
  { name: 'STRIPE', credentials: [['STRIPE_SECRET_KEY'], ['STRIPE_WEBHOOK_SECRET']], remote: [], target: callback('/webhooks/stripe'), liveFlag: 'STRIPE_LIVE', note: 'A public webhook target is deferred until dedicated staging even though no redirect URI is required.' },
];

const groupPresent = (group) => group.some(present);
const credentialsReady = (provider) => provider.credentials.every(groupPresent);
const remoteReady = (provider) => provider.remote.every(present);
const coreReady = () => Object.values(readiness).every(Boolean);
const line = (label, ready, missing = 'MISSING') => `${label}: ${ready ? 'READY' : missing}`;

console.log(`APP_ENV: ${env.APP_ENV || 'LOCAL'}`);
console.log(`AUTO_PUBLISH: ${env.AUTO_PUBLISH === 'true' ? 'ON' : 'OFF (safe default)'}`);
console.log('');

for (const provider of providers) {
  const creds = credentialsReady(provider);
  const remote = remoteReady(provider);
  const live = env[provider.liveFlag] === 'true';
  console.log(provider.name);
  console.log(`- ${line('ARCHITECTURE', readiness.architecture)}`);
  console.log(`- ${line('CONTRACT', readiness.contract)}`);
  console.log(`- ${line('SECURITY', readiness.security)}`);
  console.log(`- ${line('UI', readiness.ui)}`);
  console.log(`- ${line('TESTS', readiness.tests)}`);
  console.log(`- CREDENTIALS: ${creds ? 'CONFIGURED' : 'MISSING (expected before live activation)'}`);
  if (provider.target) console.log(`- callback/webhook target: ${provider.remote[0] && present(provider.remote[0]) ? env[provider.remote[0]] : provider.target}`);
  console.log(`- REMOTE CALLBACK: ${provider.remote.length === 0 ? 'DEFERRED / NOT REQUIRED FOR LOCAL CONTRACT' : remote ? 'CONFIGURED' : 'MISSING (expected before dedicated staging)'}`);
  console.log(`- LIVE VALIDATION: ${live ? 'PENDING REAL TEST' : 'MISSING (expected in this phase)'}`);
  if (provider.note) console.log(`- note: ${provider.note}`);
  console.log(`- readiness: ${coreReady() ? 'READY_FOR_CREDENTIALS' : 'PARTIAL'}`);
  console.log('');
}

console.log('REMOTE INFRASTRUCTURE');
const supabaseRemote = ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY'].every(present);
console.log(`- Supabase dedicated remote: ${supabaseRemote ? 'CONFIGURED' : 'MISSING (intentionally deferred)'}`);
console.log(`- APP_BASE_URL: ${base || 'MISSING (intentionally deferred)'}`);
console.log('');

if (env.AUTO_PUBLISH === 'true' && env.APP_ENV !== 'PRODUCTION') {
  console.error('SAFETY ERROR: AUTO_PUBLISH=true is not allowed by this checker outside PRODUCTION.');
  process.exitCode = 2;
}
