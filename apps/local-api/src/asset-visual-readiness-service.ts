import { createHmac } from 'node:crypto';
import { LocalAssetVisualService } from './asset-visual-service.js';
import { LocalSupabaseClient, jsonBody } from './db.js';
import { generateThumbnails } from './thumbnail-pipeline.js';
import type { RepairComponent } from '../../../packages/runtime/src/index.js';

const q=(value:string)=>encodeURIComponent(value);
const pathEncode=(value:string)=>value.split('/').map(encodeURIComponent).join('/');
const imageMimes=new Set(['image/jpeg','image/png','image/webp','image/svg+xml']);

interface ReadinessAssetRow {
  id:string;tenant_id:string;storage_bucket:string;storage_path:string;mime_type:string|null;content_hash:string|null;
  thumbnail_small_path?:string|null;thumbnail_medium_path?:string|null;thumbnail_status?:string;thumbnail_metadata?:Record<string,unknown>;
  [key:string]:unknown;
}

export class LocalAssetVisualReadinessService {
  private readonly base=new LocalAssetVisualService();
  private readonly db=new LocalSupabaseClient();

  async listAssets(token:string,tenantId:string,filter:{search?:string;type?:string;status?:string}={}){
    const assets:ReadinessAssetRow[]=await this.base.listAssets(token,tenantId,filter);
    return Promise.all(assets.map(async(asset)=>{
      const isImage=imageMimes.has(asset.mime_type??'');
      const small=isImage&&asset.thumbnail_small_path?await this.sign(asset.storage_bucket,asset.thumbnail_small_path):null;
      const medium=isImage&&asset.thumbnail_medium_path?await this.sign(asset.storage_bucket,asset.thumbnail_medium_path):null;
      const original=isImage?await this.sign(asset.storage_bucket,asset.storage_path):null;
      return{...asset,thumbnail_small_url:small,thumbnail_medium_url:medium,original_url:original,preview_url:medium??small??original};
    }));
  }

  async uploadAsset(token:string,tenantId:string,input:{filename:string;mimeType:string;dataBase64:string;description?:string;altText?:string}){
    const baseResult=await this.base.uploadAsset(token,tenantId,input);
    const result:{asset:ReadinessAssetRow;deduplicated:boolean}={asset:baseResult.asset,deduplicated:baseResult.deduplicated};
    if(!imageMimes.has(input.mimeType))return result;
    const current=result.asset;
    if(current.thumbnail_status==='ready'&&current.thumbnail_small_path&&current.thumbnail_medium_path)return result;
    const bytes=Buffer.from(input.dataBase64,'base64');
    const generated=await generateThumbnails(bytes);
    if(generated.status==='failed'){
      const patched=await this.patchAsset(tenantId,current.id,{thumbnail_status:'failed',thumbnail_metadata:{errorCode:generated.errorCode??'thumbnail_processing_failed'}});
      return{asset:{...patched,preview_url:await this.sign(current.storage_bucket,current.storage_path),original_url:await this.sign(current.storage_bucket,current.storage_path),thumbnail_small_url:null,thumbnail_medium_url:null},deduplicated:result.deduplicated};
    }
    const digest=current.content_hash??'asset';
    const small=generated.thumbnails.find((item)=>item.preset==='small');const medium=generated.thumbnails.find((item)=>item.preset==='medium');
    if(!small||!medium)throw new Error('thumbnail_preset_missing');
    const smallPath=`${tenantId}/thumbnails/small/${digest.slice(0,24)}.webp`;
    const mediumPath=`${tenantId}/thumbnails/medium/${digest.slice(0,24)}.webp`;
    await this.uploadStorage(current.storage_bucket,smallPath,small.bytes,small.mimeType,true);
    await this.uploadStorage(current.storage_bucket,mediumPath,medium.bytes,medium.mimeType,true);
    const patched=await this.patchAsset(tenantId,current.id,{thumbnail_small_path:smallPath,thumbnail_medium_path:mediumPath,thumbnail_path:mediumPath,thumbnail_status:'ready',thumbnail_metadata:{presets:{small:{width:small.width,height:small.height,bytes:small.bytes.length},medium:{width:medium.width,height:medium.height,bytes:medium.bytes.length}},source:generated.source,format:'webp'}});
    return{asset:{...patched,thumbnail_small_url:await this.sign(current.storage_bucket,smallPath),thumbnail_medium_url:await this.sign(current.storage_bucket,mediumPath),original_url:await this.sign(current.storage_bucket,current.storage_path),preview_url:await this.sign(current.storage_bucket,mediumPath)},deduplicated:result.deduplicated};
  }

  async updateAsset(token:string,tenantId:string,assetId:string,input:Record<string,unknown>){return this.base.updateAsset(token,tenantId,assetId,input);}
  async deleteAsset(token:string,tenantId:string,assetId:string){
    await this.db.requireTenantRole(token,tenantId,['owner','admin','editor']);
    const rows=await this.db.userRest<ReadinessAssetRow[]>(token,`/rest/v1/brand_assets?select=*&tenant_id=eq.${q(tenantId)}&id=eq.${q(assetId)}&limit=1`);
    const asset=rows[0];if(!asset)throw new Error('asset_not_found');
    const deleted=await this.base.deleteAsset(token,tenantId,assetId);
    for(const path of [asset.thumbnail_small_path,asset.thumbnail_medium_path].filter((value):value is string=>Boolean(value)))await this.deleteStorage(asset.storage_bucket,path);
    return deleted;
  }
  async getTemplateProfile(token:string,tenantId:string){return this.base.getTemplateProfile(token,tenantId);}
  async updateBrandVisualSettings(token:string,tenantId:string,input:{primaryLogoAssetId?:string|null;alternateLogoAssetId?:string|null;preferredVisualStyle?:Record<string,unknown>}){return this.base.updateBrandVisualSettings(token,tenantId,input);}
  async latestVisual(token:string,tenantId:string,variantId:string){return this.base.latestVisual(token,tenantId,variantId);}
  async renderPendingVariants(token:string,tenantId:string,limit=80){return this.base.renderPendingVariants(token,tenantId,limit);}
  async renderVariant(token:string,tenantId:string,variantId:string,options:{assetId?:string;rotateTemplate?:boolean;cycleAsset?:boolean;carouselType?:string}={}){return this.base.renderVariant(token,tenantId,variantId,options);}
  async repairVariant(token:string,tenantId:string,variantId:string,input:{component:RepairComponent;issueCode:string}){return this.base.repairVariant(token,tenantId,variantId,input);}

  private async patchAsset(tenantId:string,assetId:string,patch:Record<string,unknown>){
    const rows=await this.db.serviceRest<ReadinessAssetRow[]>(`/rest/v1/brand_assets?tenant_id=eq.${q(tenantId)}&id=eq.${q(assetId)}`,{method:'PATCH',headers:{'content-type':'application/json'},body:jsonBody({...patch,updated_at:new Date().toISOString()})});
    const item=rows[0];if(!item)throw new Error('asset_not_found');return item;
  }
  private async uploadStorage(bucket:string,path:string,bytes:Buffer,mime:string,upsert=false){
    if(this.db.config.backend==='neon'){
      const tenantId=path.split('/')[0];if(!tenantId)throw new Error('storage_tenant_path_required');
      await this.db.putBinaryObject({tenantId,bucket,path,bytes,mimeType:mime,upsert});return;
    }
    const response=await fetch(`${this.db.config.url}/storage/v1/object/${q(bucket)}/${pathEncode(path)}`,{method:'POST',headers:{apikey:this.db.config.serviceRoleKey,authorization:`Bearer ${this.db.config.serviceRoleKey}`,'content-type':mime,'x-upsert':String(upsert)},body:new Blob([new Uint8Array(bytes)],{type:mime})});if(!response.ok)throw new Error(`storage_upload_${response.status}:${await response.text()}`);
  }
  private async deleteStorage(bucket:string,path:string){
    if(this.db.config.backend==='neon'){await this.db.deleteBinaryObject(bucket,path);return;}
    let response=await fetch(`${this.db.config.url}/storage/v1/object/${q(bucket)}/${pathEncode(path)}`,{method:'DELETE',headers:{apikey:this.db.config.serviceRoleKey,authorization:`Bearer ${this.db.config.serviceRoleKey}`}});if(response.ok||response.status===404)return;response=await fetch(`${this.db.config.url}/storage/v1/object/${q(bucket)}`,{method:'DELETE',headers:{apikey:this.db.config.serviceRoleKey,authorization:`Bearer ${this.db.config.serviceRoleKey}`,'content-type':'application/json'},body:JSON.stringify({prefixes:[path]})});if(!response.ok&&response.status!==404)throw new Error(`storage_delete_${response.status}:${await response.text()}`);
  }
  private async sign(bucket:string,path:string){
    if(this.db.config.backend==='neon'){
      const secret=process.env.ASSET_SIGNING_SECRET?.trim();if(!secret)throw new Error('ASSET_SIGNING_SECRET_NOT_CONFIGURED');
      const exp=Math.floor(Date.now()/1000)+3600;const payload=`${bucket}\n${path}\n${exp}`;const sig=createHmac('sha256',secret).update(payload).digest('hex');
      return `/api/assets/private?bucket=${encodeURIComponent(bucket)}&path=${encodeURIComponent(path)}&exp=${exp}&sig=${sig}`;
    }
    const response=await fetch(`${this.db.config.url}/storage/v1/object/sign/${q(bucket)}/${pathEncode(path)}`,{method:'POST',headers:{apikey:this.db.config.serviceRoleKey,authorization:`Bearer ${this.db.config.serviceRoleKey}`,'content-type':'application/json'},body:JSON.stringify({expiresIn:3600})});if(!response.ok)throw new Error(`storage_sign_${response.status}`);const body=await response.json() as {signedURL?:string;signedUrl?:string};const signed=body.signedURL??body.signedUrl;if(!signed)throw new Error('storage_sign_missing_url');return signed.startsWith('http')?signed:`${this.db.config.url}${signed}`;
  }
}
