import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { LocalE2EService } from './service.js';

const port = Number(process.env.LOCAL_API_PORT ?? 8787);
const host = process.env.LOCAL_API_HOST ?? '127.0.0.1';
if (process.env.LOCAL_E2E_ENABLED !== 'true') throw new Error('LOCAL_E2E_ENABLED=true is required for the local API');

const service = new LocalE2EService();

const send = (res: ServerResponse, status: number, body: unknown, headers: Record<string,string> = {}) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
};

const sendHtml = (res: ServerResponse, status: number, body: string) => {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
};

const readJson = async <T extends Record<string, unknown>>(req: IncomingMessage): Promise<T> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString('utf-8');
  return (text ? JSON.parse(text) : {}) as T;
};

const bearer = (req: IncomingMessage): string => {
  const value = req.headers.authorization ?? '';
  if (!value.startsWith('Bearer ')) throw new Error('auth_required');
  return value.slice(7);
};

const corsHeaders = (req: IncomingMessage): Record<string,string> => {
  const origin = req.headers.origin;
  const allowed = new Set(['http://127.0.0.1:5173','http://localhost:5173','http://127.0.0.1:3000','http://localhost:3000']);
  return origin && allowed.has(origin) ? {
    'access-control-allow-origin': origin,
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'vary': 'Origin',
  } : {};
};

const pathParts = (pathname: string) => pathname.split('/').filter(Boolean).map(decodeURIComponent);

const fixtureSite = (slug: string, page: string): string => {
  const normalized = slug.toLowerCase();
  const profile = normalized.includes('pizza') ? {
    name: 'Forno Vesuvio', industry: 'Pizzeria napoletana', city: 'Milano', services: 'pizza napoletana, impasto a lunga lievitazione, prenotazioni', differentiator: 'forno ad alta temperatura e ingredienti selezionati', target: 'residenti, famiglie e gruppi locali',
  } : normalized.includes('property') ? {
    name: 'CasaChiara PM', industry: 'Property management', city: 'Milano', services: 'gestione affitti brevi, pricing dinamico, check-in, guest care', differentiator: 'controllo operativo e report trasparenti', target: 'proprietari di appartamenti',
  } : normalized.includes('network') ? {
    name: 'Marco Network Lab', industry: 'Networker', city: 'Monza', services: 'formazione, community, personal brand', differentiator: 'metodo educativo senza promesse facili', target: 'professionisti che vogliono sviluppare relazioni e competenze',
  } : {
    name: 'Bottega Locale', industry: 'Servizi locali', city: 'Milano', services: 'consulenza e assistenza locale', differentiator: 'servizio vicino al cliente e risposta rapida', target: 'clienti dell’area locale',
  };
  const nav = `<nav><a href="/fixture-site/${slug}/">Home</a> <a href="/fixture-site/${slug}/services">Servizi</a> <a href="/fixture-site/${slug}/about">Chi siamo</a> <a href="/fixture-site/${slug}/contact">Contatti</a></nav>`;
  if (page === 'services') return `<html><head><title>Servizi | ${profile.name}</title></head><body>${nav}<h1>${profile.services}</h1><p>${profile.differentiator}.</p><p>Area servita: ${profile.city}.</p></body></html>`;
  if (page === 'about') return `<html><head><title>Chi siamo | ${profile.name}</title></head><body>${nav}<h1>${profile.name}</h1><p>Siamo una realtà nel settore ${profile.industry}. Il nostro target principale: ${profile.target}.</p></body></html>`;
  if (page === 'contact') return `<html><head><title>Contatti | ${profile.name}</title></head><body>${nav}<h1>Contatti</h1><p>Siamo disponibili a ${profile.city}. Contattaci per informazioni e disponibilità.</p></body></html>`;
  return `<html><head><title>${profile.name}</title><meta name="description" content="${profile.industry} a ${profile.city}"></head><body>${nav}<h1>${profile.name}</h1><p>${profile.industry} a ${profile.city}: ${profile.differentiator}.</p><p>Servizi: ${profile.services}.</p></body></html>`;
};

const route = async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `${host}:${port}`}`);
  const parts = pathParts(url.pathname);
  const method = req.method ?? 'GET';
  const cors = corsHeaders(req);
  if (method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }

  if (parts[0] === 'fixture-site') {
    const slug = parts[1] ?? 'local-business';
    const page = parts[2] ?? 'home';
    sendHtml(res, 200, fixtureSite(slug, page));
    return;
  }

  if (url.pathname === '/health') { send(res, 200, { ok: true, mode: 'local-e2e', publishing: 'mock-only' }, cors); return; }

  if (method === 'POST' && url.pathname === '/auth/register') {
    const body = await readJson<{email:string;password:string;name:string}>(req);
    send(res, 200, await service.register(body), cors); return;
  }
  if (method === 'POST' && url.pathname === '/auth/login') {
    const body = await readJson<{email:string;password:string}>(req);
    send(res, 200, await service.login(body), cors); return;
  }
  if (method === 'GET' && url.pathname === '/tenants') { send(res, 200, await service.listTenants(bearer(req)), cors); return; }
  if (method === 'POST' && url.pathname === '/tenants') {
    const body = await readJson<{name:string;slug:string}>(req);
    send(res, 200, await service.createTenant(bearer(req), body), cors); return;
  }

  if (parts[0] === 'tenants' && parts[1]) {
    const tenantId = parts[1];
    if (method === 'GET' && parts[2] === 'workspace') { send(res, 200, await service.getWorkspace(bearer(req), tenantId), cors); return; }
    if (method === 'PATCH' && parts[2] === 'onboarding') { send(res, 200, await service.saveOnboarding(bearer(req), tenantId, await readJson(req)), cors); return; }
    if (method === 'POST' && parts[2] === 'scan') { send(res, 200, await service.scanWebsite(bearer(req), tenantId), cors); return; }
    if (method === 'POST' && parts[2] === 'social') {
      const body = await readJson<{platforms:any[];publishingModes:Record<string,'auto'|'manual'>}>(req);
      send(res, 200, await service.configureSocial(bearer(req), tenantId, { platforms: body.platforms as any, publishingModes: body.publishingModes as any }), cors); return;
    }
    if (method === 'POST' && parts[2] === 'onboarding' && parts[3] === 'complete') { send(res, 200, await service.completeOnboarding(bearer(req), tenantId), cors); return; }
    if (method === 'PATCH' && parts[2] === 'brand') { send(res, 200, await service.updateBrand(bearer(req), tenantId, await readJson(req)), cors); return; }
    if (method === 'POST' && parts[2] === 'brand' && parts[3] === 'status') {
      const body = await readJson<{status:'review'|'confirmed'}>(req); send(res, 200, await service.setBrandStatus(bearer(req), tenantId, body.status), cors); return;
    }
    if (method === 'POST' && parts[2] === 'brand' && parts[3] === 'lock') {
      const body = await readJson<{fieldPath:string;locked:boolean}>(req); send(res, 200, await service.setBrandLock(bearer(req), tenantId, body.fieldPath, body.locked), cors); return;
    }
    if (method === 'POST' && parts[2] === 'strategy') { send(res, 200, await service.generateStrategy(bearer(req), tenantId), cors); return; }
    if (method === 'POST' && parts[2] === 'calendar') { send(res, 200, await service.generateCalendar(bearer(req), tenantId, await readJson(req)), cors); return; }
    if (method === 'POST' && parts[2] === 'posts' && parts[3] === 'generate-all') {
      const body = await readJson<{limit?:number}>(req); send(res, 200, await service.generateAllDrafts(bearer(req), tenantId, body.limit ?? 20), cors); return;
    }
    if (parts[2] === 'posts' && parts[3]) {
      const postId = parts[3];
      if (method === 'GET' && parts.length === 4) { send(res, 200, await service.getPost(bearer(req), tenantId, postId), cors); return; }
      if (method === 'POST' && parts[4] === 'generate') { send(res, 200, await service.generatePost(bearer(req), tenantId, postId), cors); return; }
      if (method === 'POST' && parts[4] === 'schedule') { send(res, 200, await service.scheduleApprovedPost(bearer(req), tenantId, postId), cors); return; }
    }
    if (parts[2] === 'variants' && parts[3]) {
      const variantId = parts[3];
      if (method === 'PATCH' && parts.length === 4) { send(res, 200, await service.editVariant(bearer(req), tenantId, variantId, await readJson(req)), cors); return; }
      if (method === 'POST' && parts[4] === 'approve') { send(res, 200, await service.approveVariant(bearer(req), tenantId, variantId), cors); return; }
      if (method === 'POST' && parts[4] === 'reject') { const body = await readJson<{reason?:string}>(req); send(res, 200, await service.rejectVariant(bearer(req), tenantId, variantId, body.reason ?? ''), cors); return; }
    }
    if (method === 'POST' && parts[2] === 'publish-now') { send(res, 200, await service.publishNow(bearer(req), tenantId, await readJson(req)), cors); return; }
    if (method === 'POST' && parts[2] === 'learning' && parts[3] === 'refresh') { send(res, 200, await service.refreshLearning(bearer(req), tenantId), cors); return; }
    if (method === 'POST' && parts[2] === 'chat') { const body = await readJson<{message:string}>(req); send(res, 200, await service.chatTenant(bearer(req), tenantId, body.message), cors); return; }
  }

  if (method === 'POST' && url.pathname === '/chat/public') { const body = await readJson<{message:string}>(req); send(res, 200, await service.chatPublic(body.message), cors); return; }
  if (method === 'POST' && url.pathname === '/dev/grant-platform-admin') { send(res, 200, await service.grantSelfPlatformAdmin(bearer(req)), cors); return; }
  if (method === 'GET' && url.pathname === '/admin') { send(res, 200, await service.adminSnapshot(bearer(req)), cors); return; }

  send(res, 404, { error: 'not_found', path: url.pathname }, cors);
};

const server = createServer((req, res) => {
  route(req, res).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    const status = /auth_required|tenant_access_denied|platform_admin_required/.test(message) ? 403 : /not_found|row_not_found/.test(message) ? 404 : 400;
    send(res, status, { error: message, local: true }, corsHeaders(req));
  });
});

server.listen(port, host, () => {
  console.log(`local-e2e-api listening on http://${host}:${port}`);
});
