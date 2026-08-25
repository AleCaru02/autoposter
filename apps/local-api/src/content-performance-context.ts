import { LocalSupabaseClient } from './db.js';

const q=(value:string)=>encodeURIComponent(value);
const platforms=['instagram','facebook','linkedin','google_business_profile'] as const;
type Platform=typeof platforms[number];
interface PublishedRow {id:string;post_variant_id:string;platform:string;published_at:string;}
interface SnapshotRow {published_post_id:string;platform:string;snapshot_at:string;metrics:Record<string,unknown>;}
interface VariantRow {id:string;post_id:string;platform:string;format?:string|null;content_mode?:string|null;hashtags?:string[]|null;}
interface Score {value:number;basis:string;}
interface Aggregate {key:string;platform:Platform;label:string;sum:number;count:number;}
type Reader=<T>(path:string)=>Promise<T>;

const number=(value:unknown):number|null=>{const parsed=typeof value==='number'?value:typeof value==='string'?Number(value):NaN;return Number.isFinite(parsed)&&parsed>=0?parsed:null;};
const firstNumber=(metrics:Record<string,unknown>,keys:string[])=>{for(const key of keys){const value=number(metrics[key]);if(value!==null)return value;}return null;};
const rate=(value:number)=>value>1&&value<=100?value/100:value;
const scoreFromMetrics=(metrics:Record<string,unknown>):Score|null=>{
  const direct=firstNumber(metrics,['engagement_rate','engagementRate']);if(direct!==null)return{value:rate(direct),basis:'provider_engagement_rate'};
  const denominator=firstNumber(metrics,['reach','impressions','views','view_count']);if(!denominator||denominator<=0)return null;
  const explicit=firstNumber(metrics,['engagements','engagement','interactions','total_interactions']);if(explicit!==null)return{value:explicit/denominator,basis:'interactions_over_reach_or_impressions'};
  const componentKeys=['likes','like_count','comments','comment_count','shares','share_count','saves','saved','clicks','reactions'];const values=componentKeys.map((key)=>number(metrics[key])).filter((value):value is number=>value!==null);if(!values.length)return null;
  return{value:values.reduce((sum,value)=>sum+value,0)/denominator,basis:'known_interaction_components_over_reach_or_impressions'};
};
const normalizeHashtag=(value:string)=>value.trim().replace(/^#+/,'').toLocaleLowerCase('it-IT').replace(/\s+/g,'');
const isPlatform=(value:string):value is Platform=>platforms.includes(value as Platform);
const chunks=<T>(items:T[],size=80)=>{const result:T[][]=[];for(let index=0;index<items.length;index+=size)result.push(items.slice(index,index+size));return result;};
const rounded=(value:number)=>Number(value.toFixed(6));

export interface ContentPerformanceContext {
  status:'ready'|'insufficient_real_metrics';sampleSize:number;minimumSample:number;note:string;
  formatPerformance:Array<{platform:Platform;format:string;sampleSize:number;averageEngagementSignal:number;basis:string[]}>;
  contentModePerformance:Array<{platform:Platform;contentMode:string;sampleSize:number;averageEngagementSignal:number;basis:string[]}>;
  hashtagPerformance:Array<{platform:Platform;hashtag:string;sampleSize:number;averageEngagementSignal:number;basis:string[]}>;
}

export class ContentPerformanceContextService {
  constructor(private readonly db=new LocalSupabaseClient()){}
  async get(token:string,tenantId:string,minimumSample=6):Promise<ContentPerformanceContext>{await this.db.requireTenantRole(token,tenantId);return this.build(tenantId,<T>(path:string)=>this.db.userRest<T>(token,path),minimumSample);}
  async getServer(tenantId:string,minimumSample=6):Promise<ContentPerformanceContext>{return this.build(tenantId,<T>(path:string)=>this.db.serviceRest<T>(path),minimumSample);}

  private async build(tenantId:string,read:Reader,minimumSample:number):Promise<ContentPerformanceContext>{
    const published=await read<PublishedRow[]>(`/rest/v1/published_posts?select=id,post_variant_id,platform,published_at&tenant_id=eq.${q(tenantId)}&order=published_at.desc&limit=250`);if(!published.length)return this.empty(minimumSample);
    const snapshots=await read<SnapshotRow[]>(`/rest/v1/analytics_snapshots?select=published_post_id,platform,snapshot_at,metrics&tenant_id=eq.${q(tenantId)}&order=snapshot_at.desc&limit=1000`);const latest=new Map<string,SnapshotRow>();for(const snapshot of snapshots)if(!latest.has(snapshot.published_post_id))latest.set(snapshot.published_post_id,snapshot);
    const variantIds=[...new Set(published.map((item)=>item.post_variant_id).filter(Boolean))];const variants:VariantRow[]=[];for(const batch of chunks(variantIds))variants.push(...await read<VariantRow[]>(`/rest/v1/post_variants?select=id,post_id,platform,format,content_mode,hashtags&tenant_id=eq.${q(tenantId)}&id=in.(${batch.map(q).join(',')})`));const variantMap=new Map(variants.map((item)=>[item.id,item]));
    const formatAgg=new Map<string,Aggregate&{basis:Set<string>}>(),modeAgg=new Map<string,Aggregate&{basis:Set<string>}>(),hashtagAgg=new Map<string,Aggregate&{basis:Set<string>}>();let scored=0;
    for(const pub of published){const snapshot=latest.get(pub.id),variant=variantMap.get(pub.post_variant_id);if(!snapshot||!variant||!isPlatform(pub.platform))continue;const score=scoreFromMetrics(snapshot.metrics??{});if(!score)continue;scored+=1;const add=(map:Map<string,Aggregate&{basis:Set<string>}>,label:string)=>{if(!label||label==='unknown')return;const key=`${pub.platform}:${label}`;const row=map.get(key)??{key,platform:pub.platform as Platform,label,sum:0,count:0,basis:new Set<string>()};row.sum+=score.value;row.count+=1;row.basis.add(score.basis);map.set(key,row);};add(formatAgg,String(variant.format??'unknown'));add(modeAgg,String(variant.content_mode??'unknown'));const unique=new Set((variant.hashtags??[]).map(normalizeHashtag).filter(Boolean));for(const tag of unique)add(hashtagAgg,tag);}
    const overallReady=scored>=minimumSample;const mapRows=(map:Map<string,Aggregate&{basis:Set<string>}>,field:'format'|'contentMode'|'hashtag',minimumPerGroup:number)=>[...map.values()].filter((row)=>overallReady&&row.count>=minimumPerGroup).sort((a,b)=>(b.sum/b.count)-(a.sum/a.count)).map((row)=>({platform:row.platform,[field]:row.label,sampleSize:row.count,averageEngagementSignal:rounded(row.sum/row.count),basis:[...row.basis]}));
    return{status:overallReady?'ready':'insufficient_real_metrics',sampleSize:scored,minimumSample,note:overallReady?'Use these observations only within the same platform and alongside brand/objective fit. They are derived from real provider metrics.':'There are not enough real provider metric samples to claim a winning format, content mode or hashtag. Do not optimize from these observations yet.',formatPerformance:mapRows(formatAgg,'format',3) as ContentPerformanceContext['formatPerformance'],contentModePerformance:mapRows(modeAgg,'contentMode',3) as ContentPerformanceContext['contentModePerformance'],hashtagPerformance:mapRows(hashtagAgg,'hashtag',2) as ContentPerformanceContext['hashtagPerformance']};
  }
  private empty(minimumSample:number):ContentPerformanceContext{return{status:'insufficient_real_metrics',sampleSize:0,minimumSample,note:'No real provider analytics snapshots are available. Do not claim that a format or hashtag performs better.',formatPerformance:[],contentModePerformance:[],hashtagPerformance:[]};}
}
