import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export interface PageFetchResult {
  status: number;
  contentType: string;
  body: string;
  finalUrl?: string;
  headers?: Record<string,string>;
}

export interface PageFetcher { fetch(url: string): Promise<PageFetchResult>; }

export interface WebsiteHeading { level: number; text: string; }
export interface WebsiteResource {
  type: 'robots'|'sitemap'|'sitemap_index'|'stylesheet'|'favicon'|'logo_candidate'|'image_candidate'|'raw_page';
  url: string;
  pageUrl?: string;
  content?: string;
  contentHash?: string;
  metadata: Record<string,unknown>;
}

export interface WebsiteScanPage {
  url: string;
  status: number;
  contentType: string;
  title: string;
  metaDescription: string;
  canonicalUrl: string;
  headings: WebsiteHeading[];
  text: string;
  contentHash: string;
  discoveredLinks: string[];
  faviconUrls: string[];
  logoCandidates: string[];
  imageCandidates: string[];
  stylesheets: string[];
  colors: string[];
}

export interface WebsiteScanError {
  url: string;
  code: 'fetch_failed'|'external_redirect'|'http_error'|'robots_disallowed'|'unsafe_target'|'resource_too_large';
  message: string;
  status?: number;
}

export interface WebsiteScanResult {
  rootUrl: string;
  pages: WebsiteScanPage[];
  resources: WebsiteResource[];
  errors: WebsiteScanError[];
  visitedCount: number;
  skippedExternalCount: number;
  skippedDuplicateCount: number;
  skippedRobotsCount: number;
  redirectedCount: number;
  sitemapCount: number;
  robotsUrl: string;
  truncated: boolean;
}

const trackingParams=new Set(['gclid','fbclid','utm_source','utm_medium','utm_campaign','utm_term','utm_content']);
const unique=<T>(items:T[]):T[]=>[...new Set(items)];

export const normalizeWebsiteUrl=(input:string,base?:string):string=>{
  const url=base?new URL(input,base):new URL(input);url.hash='';
  for(const key of [...url.searchParams.keys()])if(trackingParams.has(key.toLowerCase()))url.searchParams.delete(key);
  url.hostname=url.hostname.toLowerCase();
  if((url.protocol==='https:'&&url.port==='443')||(url.protocol==='http:'&&url.port==='80'))url.port='';
  if(url.pathname.length>1)url.pathname=url.pathname.replace(/\/+$/,'');
  return url.toString();
};

const decodeEntities=(value:string)=>value.replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'");
const cleanText=(html:string):string=>decodeEntities(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim());
const attr=(tag:string,name:string):string=>tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`,'i'))?.[1]??'';
const firstMeta=(html:string,names:string[]):string=>{for(const tag of html.match(/<meta\b[^>]*>/gi)??[]){const key=(attr(tag,'name')||attr(tag,'property')).toLowerCase();if(names.includes(key)){const value=attr(tag,'content');if(value)return decodeEntities(value.trim());}}return'';};
const relLinks=(html:string,rels:string[],baseUrl:string):string[]=>{const out:string[]=[];for(const tag of html.match(/<link\b[^>]*>/gi)??[]){const rel=attr(tag,'rel').toLowerCase().split(/\s+/);if(!rels.some((item)=>rel.includes(item)))continue;const href=attr(tag,'href');if(!href)continue;try{out.push(normalizeWebsiteUrl(href,baseUrl));}catch{}}return unique(out);};
const extractLinks=(html:string,baseUrl:string):string[]=>{const out:string[]=[];for(const tag of html.match(/<a\b[^>]*>/gi)??[]){const raw=attr(tag,'href');if(!raw||/^(mailto:|tel:|javascript:)/i.test(raw))continue;try{out.push(normalizeWebsiteUrl(raw,baseUrl));}catch{}}return unique(out);};
const extractHeadings=(html:string):WebsiteHeading[]=>[...html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)].map((m)=>({level:Number(m[1]),text:cleanText(m[2]??'')})).filter((item)=>item.text);
const extractImages=(html:string,baseUrl:string):{logos:string[];images:string[]}=>{const logos:string[]=[];const images:string[]=[];const og=firstMeta(html,['og:image','twitter:image']);if(og){try{images.push(normalizeWebsiteUrl(og,baseUrl));}catch{}}for(const tag of html.match(/<img\b[^>]*>/gi)??[]){const raw=attr(tag,'src')||attr(tag,'data-src');if(!raw)continue;try{const url=normalizeWebsiteUrl(raw,baseUrl);images.push(url);const signal=`${attr(tag,'alt')} ${attr(tag,'class')} ${attr(tag,'id')} ${raw}`.toLowerCase();if(signal.includes('logo')||signal.includes('brand'))logos.push(url);}catch{}}return{logos:unique(logos),images:unique(images).slice(0,30)};};
const colorPattern=/(#[0-9a-f]{3,8}\b|rgba?\([^)]{3,60}\)|hsla?\([^)]{3,60}\))/gi;
const extractColors=(value:string):string[]=>unique((value.match(colorPattern)??[]).map((item)=>item.toLowerCase())).slice(0,24);
const extractSitemapLocs=(xml:string):string[]=>[...xml.matchAll(/<loc\b[^>]*>([\s\S]*?)<\/loc>/gi)].map((m)=>decodeEntities(cleanText(m[1]??''))).filter(Boolean);

interface RobotsRules { disallow:string[]; sitemapUrls:string[]; }
const parseRobots=(body:string):RobotsRules=>{
  const disallow:string[]=[];const sitemapUrls:string[]=[];let applies=false;
  for(const raw of body.split(/\r?\n/)){const line=raw.replace(/#.*$/,'').trim();if(!line)continue;const split=line.indexOf(':');if(split<0)continue;const key=line.slice(0,split).trim().toLowerCase();const value=line.slice(split+1).trim();
    if(key==='user-agent')applies=value==='*';
    else if(key==='disallow'&&applies&&value)disallow.push(value);
    else if(key==='sitemap'&&value)sitemapUrls.push(value);
  }
  return{disallow:unique(disallow),sitemapUrls:unique(sitemapUrls)};
};
const robotsAllows=(url:string,rules:RobotsRules):boolean=>{const parsed=new URL(url);return !rules.disallow.some((path)=>path==='/'||parsed.pathname.startsWith(path));};

export const stableContentHash=(value:string):string=>{let hash=0x811c9dc5;for(let i=0;i<value.length;i+=1){hash^=value.charCodeAt(i);hash=Math.imul(hash,0x01000193)>>>0;}return`fnv1a32:${hash.toString(16).padStart(8,'0')}`;};

const privateIpv4=(ip:string):boolean=>{const p=ip.split('.').map(Number);return p[0]===10||p[0]===127||(p[0]===169&&p[1]===254)||(p[0]===172&&(p[1]??0)>=16&&(p[1]??0)<=31)||(p[0]===192&&p[1]===168)||(p[0]===0);};
const unsafeIp=(ip:string):boolean=>isIP(ip)===4?privateIpv4(ip):isIP(ip)===6&&(ip==='::1'||ip==='::'||ip.toLowerCase().startsWith('fc')||ip.toLowerCase().startsWith('fd')||ip.toLowerCase().startsWith('fe80'));
export const assertPublicHttpUrl=async(input:string):Promise<URL>=>{
  const url=new URL(input);if(!['http:','https:'].includes(url.protocol))throw new Error('scanner_unsupported_protocol');
  if(url.username||url.password)throw new Error('scanner_unsafe_target');
  const host=url.hostname.toLowerCase();if(host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local'))throw new Error('scanner_unsafe_target');
  if(isIP(host)){if(unsafeIp(host))throw new Error('scanner_unsafe_target');return url;}
  const records=await lookup(host,{all:true,verbatim:true});if(records.length===0||records.some((record)=>unsafeIp(record.address)))throw new Error('scanner_unsafe_target');
  return url;
};

export class HttpPageFetcher implements PageFetcher {
  constructor(private readonly options:{timeoutMs?:number;maxBytes?:number;userAgent?:string;maxRedirects?:number}={}){}
  async fetch(input:string):Promise<PageFetchResult>{
    const timeoutMs=this.options.timeoutMs??8_000;const maxBytes=this.options.maxBytes??2_000_000;const maxRedirects=this.options.maxRedirects??5;let current=(await assertPublicHttpUrl(input)).toString();
    for(let redirects=0;redirects<=maxRedirects;redirects+=1){
      await assertPublicHttpUrl(current);
      const response=await fetch(current,{redirect:'manual',signal:AbortSignal.timeout(timeoutMs),headers:{'user-agent':this.options.userAgent??'AutoposterBrandScanner/1.0 (+https://autoposter-redesign-preview.vercel.app)','accept':'text/html,application/xhtml+xml,application/xml,text/plain,text/css;q=0.9,*/*;q=0.1'}});
      if(response.status>=300&&response.status<400){const location=response.headers.get('location');if(!location)return this.read(response,current,maxBytes);if(redirects===maxRedirects)throw new Error('scanner_redirect_limit');current=normalizeWebsiteUrl(location,current);continue;}
      return this.read(response,current,maxBytes);
    }
    throw new Error('scanner_redirect_limit');
  }
  private async read(response:Response,finalUrl:string,maxBytes:number):Promise<PageFetchResult>{
    const declared=Number(response.headers.get('content-length')??0);if(Number.isFinite(declared)&&declared>maxBytes)throw new Error('scanner_resource_too_large');
    const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.byteLength>maxBytes)throw new Error('scanner_resource_too_large');
    const headers:Record<string,string>={};for(const [key,value]of response.headers)headers[key]=value;
    return{status:response.status,contentType:response.headers.get('content-type')??'application/octet-stream',body:new TextDecoder().decode(bytes),finalUrl,headers};
  }
}

export class WebsiteScanner {
  constructor(private readonly fetcher:PageFetcher){}

  async scan(input:{rootUrl:string;maxPages:number}):Promise<WebsiteScanResult>{
    if(!Number.isInteger(input.maxPages)||input.maxPages<1||input.maxPages>500)throw new Error('scanner_invalid_page_limit');
    const rootUrl=normalizeWebsiteUrl(input.rootUrl);const root=new URL(rootUrl);if(!['http:','https:'].includes(root.protocol))throw new Error('scanner_unsupported_protocol');
    const resources:WebsiteResource[]=[];const errors:WebsiteScanError[]=[];const robotsUrl=new URL('/robots.txt',root.origin).toString();let robots:RobotsRules={disallow:[],sitemapUrls:[]};
    try{const response=await this.fetcher.fetch(robotsUrl);if(response.status<400){robots=parseRobots(response.body);resources.push({type:'robots',url:robotsUrl,content:response.body,contentHash:stableContentHash(response.body),metadata:{status:response.status}});}}catch{/* absence of robots is valid */}

    const sitemapQueue=unique([...robots.sitemapUrls,new URL('/sitemap.xml',root.origin).toString()]);const sitemapSeen=new Set<string>();const sitemapPages:string[]=[];
    while(sitemapQueue.length&&sitemapSeen.size<50){const raw=sitemapQueue.shift();if(!raw)break;let sitemapUrl:string;try{sitemapUrl=normalizeWebsiteUrl(raw,rootUrl);}catch{continue;}if(sitemapSeen.has(sitemapUrl)||new URL(sitemapUrl).origin!==root.origin)continue;sitemapSeen.add(sitemapUrl);
      try{const response=await this.fetcher.fetch(sitemapUrl);if(response.status>=400)continue;const locs=extractSitemapLocs(response.body);const isIndex=/<sitemapindex\b/i.test(response.body);resources.push({type:isIndex?'sitemap_index':'sitemap',url:sitemapUrl,content:response.body,contentHash:stableContentHash(response.body),metadata:{status:response.status,entries:locs.length}});for(const loc of locs){try{const normalized=normalizeWebsiteUrl(loc,sitemapUrl);if(new URL(normalized).origin!==root.origin)continue;if(isIndex)sitemapQueue.push(normalized);else sitemapPages.push(normalized);}catch{}}}catch{/* sitemap is optional */}
    }

    const queue:string[]=unique([rootUrl,...sitemapPages]);const queued=new Set(queue);const visited=new Set<string>();const pages:WebsiteScanPage[]=[];let skippedExternalCount=0;let skippedDuplicateCount=0;let skippedRobotsCount=0;let redirectedCount=0;
    while(queue.length>0&&visited.size<input.maxPages){const next=queue.shift();if(!next)break;queued.delete(next);if(visited.has(next)){skippedDuplicateCount+=1;continue;}if(!robotsAllows(next,robots)){skippedRobotsCount+=1;errors.push({url:next,code:'robots_disallowed',message:'Blocked by robots.txt'});continue;}visited.add(next);
      let response:PageFetchResult;try{response=await this.fetcher.fetch(next);}catch(error){const message=error instanceof Error?error.message:'unknown_fetch_error';errors.push({url:next,code:message.includes('unsafe_target')?'unsafe_target':message.includes('resource_too_large')?'resource_too_large':'fetch_failed',message});continue;}
      const finalUrl=normalizeWebsiteUrl(response.finalUrl??next,next);const final=new URL(finalUrl);if(finalUrl!==next)redirectedCount+=1;if(final.origin!==root.origin){skippedExternalCount+=1;errors.push({url:next,code:'external_redirect',message:`Redirected outside allowed origin: ${final.origin}`});continue;}
      const isHtml=response.contentType.toLowerCase().includes('text/html')||response.contentType.toLowerCase().includes('application/xhtml');const html=isHtml?response.body:'';const links=isHtml?extractLinks(html,finalUrl):[];const text=isHtml?cleanText(html):'';const title=isHtml?cleanText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]??''):'';const metaDescription=isHtml?firstMeta(html,['description','og:description']):'';const canonicalUrl=isHtml?(relLinks(html,['canonical'],finalUrl)[0]??finalUrl):finalUrl;const headings=isHtml?extractHeadings(html):[];const faviconUrls=isHtml?relLinks(html,['icon','shortcut','apple-touch-icon'],finalUrl):[];const stylesheets=isHtml?relLinks(html,['stylesheet'],finalUrl).filter((url)=>new URL(url).origin===root.origin).slice(0,8):[];const media=isHtml?extractImages(html,finalUrl):{logos:[],images:[]};let colors=isHtml?extractColors(html):[];
      for(const cssUrl of stylesheets.slice(0,3)){try{const css=await this.fetcher.fetch(cssUrl);if(css.status<400&&css.contentType.toLowerCase().includes('css')){colors=unique([...colors,...extractColors(css.body)]).slice(0,24);resources.push({type:'stylesheet',url:cssUrl,pageUrl:finalUrl,content:css.body.slice(0,250_000),contentHash:stableContentHash(css.body),metadata:{status:css.status}});}}catch{/* stylesheet enrichment is best-effort */}}
      for(const url of faviconUrls)resources.push({type:'favicon',url,pageUrl:finalUrl,metadata:{}});for(const url of media.logos)resources.push({type:'logo_candidate',url,pageUrl:finalUrl,metadata:{}});for(const url of media.images.slice(0,12))resources.push({type:'image_candidate',url,pageUrl:finalUrl,metadata:{}});
      resources.push({type:'raw_page',url:finalUrl,pageUrl:finalUrl,content:response.body.slice(0,500_000),contentHash:stableContentHash(response.body),metadata:{status:response.status,contentType:response.contentType}});
      const contentHash=stableContentHash(JSON.stringify({status:response.status,contentType:response.contentType,title,metaDescription,canonicalUrl,headings,text,colors}));pages.push({url:finalUrl,status:response.status,contentType:response.contentType,title,metaDescription,canonicalUrl,headings,text,contentHash,discoveredLinks:links,faviconUrls,logoCandidates:media.logos,imageCandidates:media.images,stylesheets,colors});if(response.status>=400)errors.push({url:finalUrl,code:'http_error',message:`HTTP ${response.status}`,status:response.status});
      for(const link of links){const candidate=new URL(link);if(candidate.origin!==root.origin){skippedExternalCount+=1;continue;}if(visited.has(link)||queued.has(link)){skippedDuplicateCount+=1;continue;}queue.push(link);queued.add(link);}
    }
    return{rootUrl,pages,resources,errors,visitedCount:visited.size,skippedExternalCount,skippedDuplicateCount,skippedRobotsCount,redirectedCount,sitemapCount:sitemapSeen.size,robotsUrl,truncated:queue.length>0};
  }
}

export class FixturePageFetcher implements PageFetcher {
  constructor(private readonly fixtures:Record<string,PageFetchResult|Error>){}
  async fetch(url:string):Promise<PageFetchResult>{const fixture=this.fixtures[normalizeWebsiteUrl(url)];if(!fixture)throw new Error(`fixture_not_found:${url}`);if(fixture instanceof Error)throw fixture;return{...fixture};}
}
