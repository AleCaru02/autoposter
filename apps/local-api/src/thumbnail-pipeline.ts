import sharp from 'sharp';

export const THUMBNAIL_PRESETS={
  small:{maxWidth:240,maxHeight:240,quality:72},
  medium:{maxWidth:720,maxHeight:720,quality:80},
} as const;
export type ThumbnailPresetKey=keyof typeof THUMBNAIL_PRESETS;

export interface GeneratedThumbnail {preset:ThumbnailPresetKey;bytes:Buffer;width:number;height:number;mimeType:'image/webp';hasAlpha:boolean;}
export interface ThumbnailGenerationResult {status:'ready'|'failed';thumbnails:GeneratedThumbnail[];source:{width:number;height:number;orientation:'portrait'|'landscape'|'square';hasAlpha:boolean};errorCode?:string;}

const orientation=(width:number,height:number):'portrait'|'landscape'|'square'=>width===height?'square':width>height?'landscape':'portrait';

export async function generateThumbnails(input:Buffer):Promise<ThumbnailGenerationResult>{
  try{
    const base=sharp(input,{failOn:'error',limitInputPixels:100_000_000});
    const metadata=await base.metadata();
    const width=metadata.width??0;const height=metadata.height??0;
    if(width<=0||height<=0)throw new Error('thumbnail_invalid_dimensions');
    const hasAlpha=metadata.hasAlpha===true;
    const thumbnails:GeneratedThumbnail[]=[];
    for(const [presetName,preset] of Object.entries(THUMBNAIL_PRESETS) as Array<[ThumbnailPresetKey,(typeof THUMBNAIL_PRESETS)[ThumbnailPresetKey]]>){
      const result=await sharp(input,{failOn:'error',limitInputPixels:100_000_000})
        .rotate()
        .resize({width:preset.maxWidth,height:preset.maxHeight,fit:'inside',withoutEnlargement:true})
        .webp({quality:preset.quality,alphaQuality:90,smartSubsample:true})
        .toBuffer({resolveWithObject:true});
      thumbnails.push({preset:presetName,bytes:result.data,width:result.info.width,height:result.info.height,mimeType:'image/webp',hasAlpha});
    }
    return{status:'ready',thumbnails,source:{width,height,orientation:orientation(width,height),hasAlpha}};
  }catch(error){
    return{status:'failed',thumbnails:[],source:{width:0,height:0,orientation:'square',hasAlpha:false},errorCode:error instanceof Error?error.message:'thumbnail_processing_failed'};
  }
}
