#!/usr/bin/env node

const env=process.env;
const present=(key)=>Boolean(String(env[key]??'').trim());
const status=(key)=>`${key}: ${present(key)?'present':'missing'}`;
const configReady=(keys)=>keys.every((key)=>present(key));
const base=String(env.APP_BASE_URL??'').replace(/\/$/,'');
const callback=(path)=>base?`${base}${path}`:`<APP_BASE_URL>${path}`;

const providers=[
  {name:'OPENAI',required:['OPENAI_API_KEY'],config:['APP_ENV'],notes:[`capability registry: ready`,`live flag: ${env.OPENAI_LIVE==='true'?'ON':'OFF'}`]},
  {name:'META',required:['META_APP_ID','META_APP_SECRET'],config:['META_REDIRECT_URI'],notes:[`callback: ${env.META_REDIRECT_URI||callback('/oauth/meta/callback')}`,`contracts: ready`,`live flag: ${env.META_LIVE==='true'?'ON':'OFF'}`]},
  {name:'LINKEDIN',required:['LINKEDIN_CLIENT_ID','LINKEDIN_CLIENT_SECRET'],config:['LINKEDIN_REDIRECT_URI','LINKEDIN_API_VERSION'],notes:[`callback: ${env.LINKEDIN_REDIRECT_URI||callback('/oauth/linkedin/callback')}`,`contracts: ready`,`live flag: ${env.LINKEDIN_LIVE==='true'?'ON':'OFF'}`]},
  {name:'GOOGLE BUSINESS PROFILE',required:['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET'],config:['GOOGLE_GBP_REDIRECT_URI'],notes:[`callback: ${env.GOOGLE_GBP_REDIRECT_URI||callback('/oauth/google-business-profile/callback')}`,`contracts: ready`,`live flag: ${env.GBP_LIVE==='true'?'ON':'OFF'}`]},
  {name:'TELEGRAM',required:['TELEGRAM_BOT_TOKEN','TELEGRAM_WEBHOOK_SECRET'],config:['TELEGRAM_WEBHOOK_URL'],notes:[`webhook: ${env.TELEGRAM_WEBHOOK_URL||callback('/webhooks/telegram')}`,`contracts: ready`,`live flag: ${env.TELEGRAM_LIVE==='true'?'ON':'OFF'}`]},
  {name:'STRIPE',required:['STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET'],config:[],notes:[`webhook: ${callback('/webhooks/stripe')}`,`billing contracts: ready`,`live flag: ${env.STRIPE_LIVE==='true'?'ON':'OFF'}`]},
  {name:'SUPABASE REMOTE',required:['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','SUPABASE_SERVICE_ROLE_KEY'],config:[],notes:['migrations: repository source of truth']},
];

console.log(`APP_ENV: ${env.APP_ENV||'LOCAL (default)'}`);
console.log(`AUTO_PUBLISH: ${env.AUTO_PUBLISH==='true'?'ON':'OFF (safe default)'}`);
console.log('');
for(const provider of providers){
  console.log(provider.name);
  for(const key of provider.required)console.log(`- ${status(key)}`);
  for(const key of provider.config)console.log(`- ${key}: ${present(key)?'configured':'missing'}`);
  for(const note of provider.notes)console.log(`- ${note}`);
  const credentialsReady=provider.required.every((key)=>present(key));
  const providerConfigReady=configReady(provider.config);
  console.log(`- readiness: ${credentialsReady&&providerConfigReady?'CREDENTIALS_CONFIGURED':providerConfigReady||provider.config.length===0?'READY_FOR_CREDENTIALS':'CONFIG_INCOMPLETE'}`);
  console.log('');
}

if(env.AUTO_PUBLISH==='true'&&env.APP_ENV!=='PRODUCTION'){
  console.error('SAFETY ERROR: AUTO_PUBLISH=true is not allowed by this checker outside PRODUCTION.');
  process.exitCode=2;
}
