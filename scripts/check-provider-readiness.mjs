#!/usr/bin/env node

const env=process.env;
const present=(key)=>Boolean(String(env[key]??'').trim());
const base=String(env.APP_BASE_URL??'').replace(/\/$/,'');
const callback=(path)=>base?`${base}${path}`:`<APP_BASE_URL>${path}`;
const yesNo=(value)=>value?'READY':'MISSING';

const providers=[
  {name:'OPENAI',credentials:['OPENAI_API_KEY'],remote:[],callback:null,architecture:true,contract:true,security:true,ui:true,tests:true,liveFlag:'OPENAI_LIVE'},
  {name:'META',credentials:['META_APP_ID','META_APP_SECRET'],remote:['META_REDIRECT_URI'],callback:callback('/oauth/meta/callback'),architecture:true,contract:true,security:true,ui:true,tests:true,liveFlag:'META_LIVE'},
  {name:'LINKEDIN',credentials:['LINKEDIN_CLIENT_ID','LINKEDIN_CLIENT_SECRET'],remote:['LINKEDIN_REDIRECT_URI','LINKEDIN_API_VERSION'],callback:callback('/oauth/linkedin/callback'),architecture:true,contract:true,security:true,ui:true,tests:true,liveFlag:'LINKEDIN_LIVE'},
  {name:'GOOGLE BUSINESS PROFILE',credentials:['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET'],remote:['GOOGLE_GBP_REDIRECT_URI'],callback:callback('/oauth/google-business-profile/callback'),architecture:true,contract:true,security:true,ui:true,tests:true,liveFlag:'GBP_LIVE'},
  {name:'TELEGRAM',credentials:['TELEGRAM_BOT_TOKEN','TELEGRAM_WEBHOOK_SECRET'],remote:['TELEGRAM_WEBHOOK_URL'],callback:callback('/webhooks/telegram'),architecture:true,contract:true,security:true,ui:true,tests:true,liveFlag:'TELEGRAM_LIVE'},
  {name:'STRIPE',credentials:['STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET'],remote:[],callback:callback('/webhooks/stripe'),architecture:true,contract:true,security:true,ui:true,tests:true,liveFlag:'STRIPE_LIVE'},
  {name:'SUPABASE REMOTE',credentials:['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','SUPABASE_SERVICE_ROLE_KEY'],remote:[],callback:null,architecture:true,contract:true,security:true,ui:true,tests:true,liveFlag:null},
];

console.log(`APP_ENV: ${env.APP_ENV||'LOCAL'}`);
console.log(`AUTO_PUBLISH: ${env.AUTO_PUBLISH==='true'?'ON':'OFF (safe default)'}`);
console.log('');
for(const provider of providers){
  const coreReady=provider.architecture&&provider.contract&&provider.security&&provider.ui&&provider.tests;
  const credentialsPresent=provider.credentials.every(present);
  const remoteReady=provider.remote.every(present);
  console.log(provider.name);
  console.log(`- ARCHITECTURE: ${yesNo(provider.architecture)}`);
  console.log(`- CONTRACT: ${yesNo(provider.contract)}`);
  console.log(`- SECURITY: ${yesNo(provider.security)}`);
  console.log(`- UI: ${yesNo(provider.ui)}`);
  console.log(`- TESTS: ${yesNo(provider.tests)}`);
  for(const key of provider.credentials)console.log(`- ${key}: ${present(key)?'present':'missing (expected before live activation)'}`);
  if(provider.callback)console.log(`- callback/webhook target: ${provider.remote[0]&&present(provider.remote[0])?env[provider.remote[0]]:provider.callback}`);
  for(const key of provider.remote)console.log(`- ${key}: ${present(key)?'configured':'missing (remote/live step)'}`);
  console.log(`- CREDENTIALS: ${credentialsPresent?'CONFIGURED':'MISSING'}`);
  console.log(`- REMOTE_CALLBACK: ${provider.remote.length===0?'NOT_REQUIRED_OR_DEFERRED':remoteReady?'CONFIGURED':'MISSING'}`);
  console.log(`- LIVE_VALIDATION: ${provider.liveFlag&&env[provider.liveFlag]==='true'?'PENDING_REAL_TEST':'MISSING'}`);
  console.log(`- readiness: ${coreReady?'READY_FOR_CREDENTIALS':'PARTIAL'}`);
  console.log('');
}

if(env.AUTO_PUBLISH==='true'&&env.APP_ENV!=='PRODUCTION'){
  console.error('SAFETY ERROR: AUTO_PUBLISH=true is not allowed by this checker outside PRODUCTION.');
  process.exitCode=2;
}
