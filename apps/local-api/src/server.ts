import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { LocalE2EService } from './service.js';
import { LocalAssetVisualReadinessService } from './asset-visual-readiness-service.js';
import { TelegramApprovalService } from './telegram-approval-service.js';
import { ApprovalDecisionService } from './approval-decision-service.js';
import { tryProviderReadinessRoute } from './provider-route-handler.js';
import { LocalSupabaseClient, jsonBody } from './db.js';
import { AdminCustomerService } from './admin-customer-service.js';
import { FixedWindowRateLimiter, clientSubject, corsHeaders, ratePolicy, readJsonLimited, sanitizedError, securityHeaders } from './security.js';

const port=Number(process.env.LOCAL_API_PORT??8787);const host=process.env.LOCAL_API_HOST??'127.0.0.1';
if(process.env.LOCAL_E2E_ENABLED!=='true')throw new Error('LOCAL_E2E_ENABLED=true is required for the local API');
const service=new LocalE2EService();const visual=new LocalAssetVisualReadinessService();const telegram=new TelegramApprovalService();const approval=new ApprovalDecisionService();const localDb=new LocalSupabaseClient();const admin=new AdminCustomerService(localDb);const limiter=new FixedWindowRateLimiter();
const send=(res:ServerResponse,status:number,body:unknown,headers:Record<string,string>={})=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...securityHeaders(),...headers});res.end(JSON.stringify(body));};
const sendHtml=(res:ServerResponse,status:number,body:string,headers:Record<string,string>={})=>{res.writeHead(status,{'content-type':'text/html; charset=utf-8','cache-control':'no-store',...securityHeaders(),...headers});res.end(body);};
const readJson=readJsonLimited;
const bearer=(req:IncomingMessage):string=>{const value=req.headers.authorization??'';if(!value.startsWith('Bearer '))throw new Error('auth_required');return value.slice(7);};
const header=(req:IncomingMessage,name:string):string|undefined=>{const value=req.headers[name.toLowerCase()];return Array.isArray(value)?value[0]:value;};
const pathParts=(pathname:string)=>pathname.split('/').filter(Boolean).map(decodeURIComponent);const q=(value:string)=>encodeURIComponent(value);
const fixtureSite=(slug:string,page:string):string=>{const normalized=slug.toLowerCase();const profile=normalized.includes('pizza')?{name:'Forno Vesuvio',industry:'Pizzeria napoletana',city:'Milano',services:'pizza napoletana, impasto a lunga lievitazione, prenotazioni',differentiator:'forno ad alta temperatura e ingredienti selezionati',target:'residenti, famiglie e gruppi locali'}:normalized.includes('property')?{name:'CasaChiara PM',industry:'Property management',city:'Milano',services:'gestione affitti brevi, pricing dinamico, check-in, guest care',differentiator:'controllo operativo e report trasparenti',target:'proprietari di appartamenti'}:normalized.includes('network')?{name:'Marco Network Lab',industry:'Networker',city:'Monza',services:'formazione, community, personal brand',differentiator:'metodo educativo senza promesse facili',target:'professionisti che vogliono sviluppare relazioni e competenze'}:{name:'Bottega Locale',industry:'Servizi locali',city:'Milano',services:'consulenza e assistenza locale',differentiator:'servizio vicino al cliente e risposta rapida',target:'clienti dell’area locale'};const nav=`<nav><a href="/fixture-site/${slug}/">Home</a> <a href="/fixture-site/${slug}/services">Servizi</a> <a href="/fixture-site/${slug}/about">Chi siamo</a> <a href="/fixture-site/${slug}/contact">Contatti</a></nav>`;if(page==='services')return`<html><head><title>Servizi | ${profile.name}</title></head><body>${nav}<h1>${profile.services}</h1><p>${profile.differentiator}.</p><p>Area servita: ${profile.city}.</p></body></html>`;if(page==='about')return`<html><head><title>Chi siamo | ${profile.name}</title></head><body>${nav}<h1>${profile.name}</h1><p>Siamo una realtà nel settore ${profile.industry}. Il nostro target principale: ${profile.target}.</p></body></html>`;if(page==='contact')return`<html><head><title>Contatti | ${profile.name}</title></head><body>${nav}<h1>Contatti</h1><p>Siamo disponibili a ${profile.city}. Contattaci per informazioni e disponibilità.</p></body></html>`;return`<html><head><title>${profile.name}</title><meta name="description" content="${profile.industry} a ${profile.city}"></head><body>${nav}<h1>${profile.name}</h1><p>${profile.industry} a ${profile.city}: ${profile.differentiator}.</p><p>Servizi: ${profile.services}.</p></body></html>`;};

const route=async(req:IncomingMessage,res:ServerResponse)=>{
  const url=new URL(req.url??'/',`http://${req.headers.host??`${host}:${port}`}`);const parts=pathParts(url.pathname);const method=req.method??'GET';const cors=corsHeaders(req);if(method==='OPTIONS'){res.writeHead(204,{...securityHeaders(),...cors});res.end();return;}
  const policy=ratePolicy(url.pathname);if(policy){const result=limiter.consume({...policy,subject:clientSubject(req)});if(!result.allowed){send(res,429,{error:'rate_limit_exceeded',retryAfterSeconds:result.retryAfterSeconds},{...cors,'retry-after':String(result.retryAfterSeconds)});return;}}
  if(method==='POST'&&url.pathname==='/webhooks/telegram'){send(res,200,await telegram.handleWebhook(header(req,'x-telegram-bot-api-secret-token'),await readJson(req) as any),cors);return;}
  const providerRoute=await tryProviderReadinessRoute(req,url,parts,method);if(providerRoute.handled){send(res,providerRoute.status??200,providerRoute.body??{},cors);return;}
  if(parts[0]==='fixture-site'){sendHtml(res,200,fixtureSite(parts[1]??'local-business',parts[2]??'home'),cors);return;}
  if(url.pathname==='/health'){send(res,200,{ok:true,testHarness:'local-e2e',publishing:'fixture-only',visual:'deterministic-test',providers:'fixture-only',hardening:{cors:'allowlist',securityHeaders:true,rateLimits:true}},cors);return;}
  if(method==='POST'&&url.pathname==='/auth/register'){send(res,200,await service.register(await readJson(req) as any),cors);return;}
  if(method==='POST'&&url.pathname==='/auth/login'){send(res,200,await service.login(await readJson(req) as any),cors);return;}
  if(method==='GET'&&url.pathname==='/tenants'){send(res,200,await service.listTenants(bearer(req)),cors);return;}
  if(method==='POST'&&url.pathname==='/tenants'){send(res,200,await service.createTenant(bearer(req),await readJson(req) as any),cors);return;}
  if(parts[0]==='tenants'&&parts[1]){
    const tenantId=parts[1],token=()=>bearer(req);
    if(method==='GET'&&parts[2]==='assets'){send(res,200,await visual.listAssets(token(),tenantId,{search:url.searchParams.get('search')??'',type:url.searchParams.get('type')??'',status:url.searchParams.get('status')??''}),cors);return;}
    if(method==='POST'&&parts[2]==='assets'&&parts.length===3){send(res,200,await visual.uploadAsset(token(),tenantId,await readJson(req) as any),cors);return;}
    if(parts[2]==='assets'&&parts[3]){if(method==='PATCH'){send(res,200,await visual.updateAsset(token(),tenantId,parts[3],await readJson(req)),cors);return;}if(method==='DELETE'){send(res,200,await visual.deleteAsset(token(),tenantId,parts[3]),cors);return;}}
    if(method==='GET'&&parts[2]==='visual-template-profile'){send(res,200,await visual.getTemplateProfile(token(),tenantId),cors);return;}
    if(method==='PATCH'&&parts[2]==='brand'&&parts[3]==='visual-settings'){send(res,200,await visual.updateBrandVisualSettings(token(),tenantId,await readJson(req) as any),cors);return;}
    if(method==='GET'&&parts[2]==='telegram'&&parts.length===3){send(res,200,await telegram.status(token(),tenantId),cors);return;}
    if(method==='POST'&&parts[2]==='telegram'&&parts[3]==='pair'){send(res,200,await telegram.createPairing(token(),tenantId),cors);return;}
    if(method==='POST'&&parts[2]==='telegram'&&parts[3]==='disconnect'){send(res,200,await telegram.disconnect(token(),tenantId),cors);return;}
    if(parts[2]==='variants'&&parts[3]&&parts[4]==='telegram-preview'&&method==='POST'){send(res,200,await telegram.sendVariantPreview(token(),tenantId,parts[3]),cors);return;}
    if(parts[2]==='variants'&&parts[3]&&parts[4]==='visual'){if(method==='GET'){send(res,200,await visual.latestVisual(token(),tenantId,parts[3]),cors);return;}if(method==='POST'){send(res,200,await visual.renderVariant(token(),tenantId,parts[3],await readJson(req) as any),cors);return;}}
    if(parts[2]==='variants'&&parts[3]&&parts[4]==='repair'&&method==='POST'){send(res,200,await visual.repairVariant(token(),tenantId,parts[3],await readJson(req) as any),cors);return;}
    if(method==='GET'&&parts[2]==='workspace'){send(res,200,await service.getWorkspace(token(),tenantId),cors);return;}
    if(method==='PATCH'&&parts[2]==='onboarding'){send(res,200,await service.saveOnboarding(token(),tenantId,await readJson(req)),cors);return;}
    if(method==='POST'&&parts[2]==='scan'){send(res,200,await service.scanWebsite(token(),tenantId),cors);return;}
    if(method==='POST'&&parts[2]==='social'){send(res,200,await service.configureSocial(token(),tenantId,await readJson(req) as any),cors);return;}
    if(method==='POST'&&parts[2]==='onboarding'&&parts[3]==='complete'){send(res,200,await service.completeOnboarding(token(),tenantId),cors);return;}
    if(method==='PATCH'&&parts[2]==='brand'){send(res,200,await service.updateBrand(token(),tenantId,await readJson(req)),cors);return;}
    if(method==='POST'&&parts[2]==='brand'&&parts[3]==='status'){const body=await readJson<{status:'review'|'confirmed'}>(req);send(res,200,await service.setBrandStatus(token(),tenantId,body.status),cors);return;}
    if(method==='POST'&&parts[2]==='brand'&&parts[3]==='lock'){const body=await readJson<{fieldPath:string;locked:boolean}>(req);send(res,200,await service.setBrandLock(token(),tenantId,body.fieldPath,body.locked),cors);return;}
    if(method==='POST'&&parts[2]==='strategy'){send(res,200,await service.generateStrategy(token(),tenantId),cors);return;}
    if(method==='POST'&&parts[2]==='calendar'){send(res,200,await service.generateCalendar(token(),tenantId,await readJson(req)),cors);return;}
    if(method==='POST'&&parts[2]==='posts'&&parts[3]==='generate-all'){const body=await readJson<{limit?:number}>(req);const limit=body.limit??20;const generated=await service.generateAllDrafts(token(),tenantId,limit);await visual.renderPendingVariants(token(),tenantId,Math.max(limit*4,20));send(res,200,generated,cors);return;}
    if(parts[2]==='posts'&&parts[3]){const postId=parts[3];if(method==='GET'&&parts.length===4){send(res,200,await service.getPost(token(),tenantId,postId),cors);return;}if(method==='POST'&&parts[4]==='generate'){const generated=await service.generatePost(token(),tenantId,postId);await visual.renderPendingVariants(token(),tenantId,20);send(res,200,generated,cors);return;}if(method==='POST'&&parts[4]==='schedule'){send(res,200,await service.scheduleApprovedPost(token(),tenantId,postId),cors);return;}}
    if(parts[2]==='variants'&&parts[3]){const variantId=parts[3];if(method==='PATCH'&&parts.length===4){send(res,200,await service.editVariant(token(),tenantId,variantId,await readJson(req)),cors);return;}if(method==='POST'&&parts[4]==='approve'){send(res,200,await approval.approveWeb(token(),tenantId,variantId),cors);return;}if(method==='POST'&&parts[4]==='reject'){const body=await readJson<{reason?:string}>(req);send(res,200,await approval.rejectWeb(token(),tenantId,variantId,body.reason??'Non pubblicare'),cors);return;}if(method==='POST'&&parts[4]==='publish'){send(res,200,await approval.publishApprovedWeb(token(),tenantId,variantId),cors);return;}}
    if(method==='POST'&&parts[2]==='publish-now'){send(res,200,await service.publishNow(token(),tenantId,await readJson(req)),cors);return;}
    if(method==='POST'&&parts[2]==='learning'&&parts[3]==='refresh'){send(res,200,await service.refreshLearning(token(),tenantId),cors);return;}
    if(method==='POST'&&parts[2]==='chat'){const body=await readJson<{message:string}>(req);send(res,200,await service.chatTenant(token(),tenantId,body.message),cors);return;}
    if(method==='POST'&&parts[2]==='lifecycle'&&parts[3]==='delete-request'){const body=await readJson<{scope?:'ACCOUNT'|'TENANT';reason?:string}>(req);send(res,200,await admin.requestDeletion(token(),tenantId,body.scope??'TENANT',body.reason??''),cors);return;}
    if(method==='POST'&&parts[2]==='lifecycle'&&parts[3]==='revoke-connections'){send(res,200,await admin.revokeTenantConnections(token(),tenantId),cors);return;}
  }
  if(method==='POST'&&url.pathname==='/chat/public'){const body=await readJson<{message:string}>(req);send(res,200,await service.chatPublic(body.message),cors);return;}
  if(method==='POST'&&url.pathname==='/dev/grant-platform-admin'){
    const token=bearer(req);const user=await localDb.getUser(token);await localDb.serviceRest('/rest/v1/platform_admins',{method:'POST',headers:{prefer:'resolution=ignore-duplicates,return=minimal'},body:jsonBody({user_id:user.id,created_by:user.id})});send(res,200,{ok:true,userId:user.id},cors);return;
  }
  if(method==='GET'&&url.pathname==='/admin'){send(res,200,await service.adminSnapshot(bearer(req)),cors);return;}
  if(method==='GET'&&url.pathname==='/admin/customers'){send(res,200,await admin.snapshot(bearer(req)),cors);return;}
  if(parts[0]==='admin'&&parts[1]==='tenants'&&parts[2]){const tenantId=parts[2];if(method==='POST'&&parts[3]==='plan'){send(res,200,await admin.assignManualPlan(bearer(req),tenantId,await readJson(req) as any),cors);return;}if(method==='PATCH'&&parts[3]==='overrides'){send(res,200,await admin.setOverrides(bearer(req),tenantId,await readJson(req) as any),cors);return;}if(method==='PATCH'&&parts[3]==='status'){const body=await readJson<{status:'active'|'suspended'|'closed'}>(req);send(res,200,await admin.setStatus(bearer(req),tenantId,body.status),cors);return;}if(method==='PATCH'&&parts[3]==='ai-budget'){send(res,200,await admin.setTenantAiBudget(bearer(req),tenantId,await readJson(req) as any),cors);return;}}
  if(method==='PATCH'&&url.pathname==='/admin/ai-budget'){send(res,200,await admin.setGlobalAiBudget(bearer(req),await readJson(req) as any),cors);return;}
  if(parts[0]==='admin'&&parts[1]==='deletion-requests'&&parts[2]&&parts[3]==='execute'&&method==='POST'){send(res,200,await admin.executeDeletion(bearer(req),parts[2]),cors);return;}
  send(res,404,{error:'not_found',path:url.pathname},cors);
};

const server=createServer((req,res)=>{route(req,res).catch((error:unknown)=>{const message=error instanceof Error?error.message:String(error);const status=/auth_required|tenant_access_denied|platform_admin_required|FEATURE_NOT_ENTITLED|TELEGRAM_USER_NOT_AUTHORIZED|HUMAN_APPROVAL_REQUIRED/.test(message)?403:/WEBHOOK_SIGNATURE_INVALID/.test(message)?401:/not_found|row_not_found|asset_not_found|provider_account_not_found|provider_connection_not_found/.test(message)?404:/file_too_large|mime_not_supported|request_body_too_large/.test(message)?413:400;send(res,status,{error:sanitizedError(error),local:true},corsHeaders(req));});});
server.listen(port,host,()=>{console.log(`local-e2e-api listening on http://${host}:${port}`);});