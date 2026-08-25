import { describe, expect, it } from 'vitest';
import { ContentPerformanceContextService } from '../src/content-performance-context.js';
import type { LocalSupabaseClient } from '../src/db.js';

const tenant='11111111-1111-1111-1111-111111111111';
const published=(count:number)=>Array.from({length:count},(_,index)=>({id:`pub-${index}`,post_variant_id:`var-${index}`,platform:'instagram',published_at:`2026-08-${String(index+1).padStart(2,'0')}T10:00:00Z`}));
const snapshots=(count:number)=>Array.from({length:count},(_,index)=>({published_post_id:`pub-${index}`,platform:'instagram',snapshot_at:`2026-08-${String(index+1).padStart(2,'0')}T20:00:00Z`,metrics:index<3?{engagement_rate:0.12}:{engagement_rate:0.03}}));
const variants=(count:number)=>Array.from({length:count},(_,index)=>({id:`var-${index}`,post_id:`post-${index}`,platform:'instagram',format:index<3?'carousel':'post',content_mode:index<3?'storytelling':'promotional',hashtags:index<3?['locale','dietrolequinte']:['offerta']}));

function fakeDb(count:number){
  return{
    serviceRest:async<T>(path:string):Promise<T>=>{
      if(path.includes('/published_posts?'))return published(count) as T;
      if(path.includes('/analytics_snapshots?'))return snapshots(count) as T;
      if(path.includes('/post_variants?'))return variants(count) as T;
      throw new Error(`unexpected_path:${path}`);
    },
  } as unknown as LocalSupabaseClient;
}

describe('ContentPerformanceContextService',()=>{
  it('does not declare winners below the real-metric sample threshold',async()=>{
    const result=await new ContentPerformanceContextService(fakeDb(2)).getServer(tenant,6);
    expect(result.status).toBe('insufficient_real_metrics');
    expect(result.sampleSize).toBe(2);
    expect(result.formatPerformance).toEqual([]);
    expect(result.hashtagPerformance).toEqual([]);
  });

  it('uses sufficient real metrics to rank format, content mode and hashtag observations',async()=>{
    const result=await new ContentPerformanceContextService(fakeDb(6)).getServer(tenant,6);
    expect(result.status).toBe('ready');
    expect(result.sampleSize).toBe(6);
    expect(result.formatPerformance[0]).toMatchObject({platform:'instagram',format:'carousel',sampleSize:3,averageEngagementSignal:0.12});
    expect(result.contentModePerformance[0]).toMatchObject({contentMode:'storytelling',sampleSize:3});
    expect(result.hashtagPerformance.find((row)=>row.hashtag==='locale')).toMatchObject({sampleSize:3,averageEngagementSignal:0.12});
  });
});
