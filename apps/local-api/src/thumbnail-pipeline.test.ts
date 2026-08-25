import { describe,expect,it } from 'vitest';
import sharp from 'sharp';
import { generateThumbnails, THUMBNAIL_PRESETS } from './thumbnail-pipeline.js';

const image=async(width:number,height:number,alpha=false)=>sharp({create:{width,height,channels:alpha?4:3,background:alpha?{r:120,g:80,b:40,alpha:.5}:{r:120,g:80,b:40}}}).png().toBuffer();

describe('thumbnail pipeline',()=>{
  it('creates centralized small and medium WebP thumbnails for a large landscape image',async()=>{const result=await generateThumbnails(await image(4000,2000));expect(result.status).toBe('ready');expect(result.source.orientation).toBe('landscape');expect(result.thumbnails.map((item)=>item.preset)).toEqual(['small','medium']);const small=result.thumbnails.find((item)=>item.preset==='small')!;const medium=result.thumbnails.find((item)=>item.preset==='medium')!;expect(small.width).toBeLessThanOrEqual(THUMBNAIL_PRESETS.small.maxWidth);expect(medium.width).toBeLessThanOrEqual(THUMBNAIL_PRESETS.medium.maxWidth);expect(small.mimeType).toBe('image/webp');});
  it('preserves portrait/square geometry without enlargement',async()=>{const portrait=await generateThumbnails(await image(300,600));expect(portrait.source.orientation).toBe('portrait');expect(portrait.thumbnails.find((item)=>item.preset==='medium')?.height).toBe(600);const square=await generateThumbnails(await image(500,500));expect(square.source.orientation).toBe('square');expect(square.thumbnails.find((item)=>item.preset==='medium')?.width).toBe(500);});
  it('preserves alpha information in metadata',async()=>{const result=await generateThumbnails(await image(800,800,true));expect(result.status).toBe('ready');expect(result.source.hasAlpha).toBe(true);expect(result.thumbnails.every((item)=>item.hasAlpha)).toBe(true);});
  it('returns structured processing error for corrupt image data',async()=>{const result=await generateThumbnails(Buffer.from('not-an-image'));expect(result.status).toBe('failed');expect(result.thumbnails).toHaveLength(0);expect(result.errorCode).toBeTruthy();});
});
