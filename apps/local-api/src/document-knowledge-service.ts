import { MockDocumentIngestionProvider, ingestDocument } from '../../../packages/runtime/src/index.js';
import { LocalSupabaseClient, jsonBody } from './db.js';

const q=(value:string)=>encodeURIComponent(value);
const pathEncode=(value:string)=>value.split('/').map(encodeURIComponent).join('/');
const now=()=>new Date().toISOString();
const jsonHeaders={'content-type':'application/json'};

interface AssetRow {id:string;tenant_id:string;kind:string;storage_bucket:string;storage_path:string;original_filename:string|null;mime_type:string|null;}
interface IngestionRow {id:string;tenant_id:string;asset_id:string;status:string;provider_key:string;}

export class DocumentKnowledgeService {
  private readonly db=new LocalSupabaseClient();
  private readonly provider=new MockDocumentIngestionProvider();

  async list(token:string,tenantId:string){await this.db.requireTenantRole(token,tenantId);return this.db.userRest(token,`/rest/v1/document_ingestions?select=*&tenant_id=eq.${q(tenantId)}&order=created_at.desc`);}

  async ingest(token:string,tenantId:string,assetId:string){
    const auth=await this.db.requireTenantRole(token,tenantId,['owner','admin','editor']);
    const asset=this.first(await this.db.userRest<AssetRow[]>(token,`/rest/v1/brand_assets?select=*&tenant_id=eq.${q(tenantId)}&id=eq.${q(assetId)}&limit=1`),'asset_not_found');
    if(asset.kind!=='document'&&asset.mime_type!=='application/pdf')throw new Error('document_asset_required');
    const existing=await this.db.serviceRest<IngestionRow[]>(`/rest/v1/document_ingestions?select=*&tenant_id=eq.${q(tenantId)}&asset_id=eq.${q(assetId)}&limit=1`);
    const ingestion=existing[0]??this.first(await this.db.serviceRest<IngestionRow[]>('/rest/v1/document_ingestions',{method:'POST',headers:jsonHeaders,body:jsonBody({tenant_id:tenantId,asset_id:assetId,status:'UPLOADED',provider_key:this.provider.key})}));
    await this.db.serviceRest(`/rest/v1/document_ingestions?tenant_id=eq.${q(tenantId)}&id=eq.${q(ingestion.id)}`,{method:'PATCH',headers:jsonHeaders,body:jsonBody({status:'PROCESSING',started_at:now(),error_code:null,updated_at:now()})});
    const bytes=await this.download(asset.storage_bucket,asset.storage_path);
    const result=await ingestDocument(this.provider,{tenantId,assetId,mimeType:asset.mime_type??'application/octet-stream',filename:asset.original_filename??assetId,bytes:new Uint8Array(bytes)});
    await this.db.serviceRest(`/rest/v1/document_chunks?tenant_id=eq.${q(tenantId)}&ingestion_id=eq.${q(ingestion.id)}`,{method:'DELETE'});
    if(result.status==='INDEXED'){
      for(const chunk of result.chunks)await this.db.serviceRest('/rest/v1/document_chunks',{method:'POST',headers:jsonHeaders,body:jsonBody({tenant_id:tenantId,ingestion_id:ingestion.id,chunk_index:chunk.index,content:chunk.content,content_hash:chunk.contentHash,metadata:chunk.metadata})});
      const source=this.first(await this.db.serviceRest<Array<{id:string}>>('/rest/v1/knowledge_sources',{method:'POST',headers:jsonHeaders,body:jsonBody({tenant_id:tenantId,source_type:'DOCUMENT',source_ref:assetId,source_entity_id:assetId,confidence:.85,confirmed:false,metadata:{ingestionId:ingestion.id,filename:asset.original_filename,mimeType:asset.mime_type,createdBy:auth.userId}})}));
      const facts=[
        {fact_key:'document.type',fact_value:{value:String(result.classification.documentType??'document')},confidence:.8},
        {fact_key:'document.summary',fact_value:{value:result.summary??''},confidence:.75},
      ];
      for(const fact of facts)await this.db.serviceRest('/rest/v1/knowledge_facts',{method:'POST',headers:jsonHeaders,body:jsonBody({tenant_id:tenantId,source_id:source.id,...fact,confirmed:false})});
    }
    const updated=this.first(await this.db.serviceRest<Array<Record<string,unknown>>>(`/rest/v1/document_ingestions?tenant_id=eq.${q(tenantId)}&id=eq.${q(ingestion.id)}`,{method:'PATCH',headers:jsonHeaders,body:jsonBody({status:result.status,extracted_text:result.text??null,extracted_metadata:result.metadata,classification:result.classification,summary:result.summary??null,chunk_count:result.chunks.length,error_code:result.errorCode??null,completed_at:now(),updated_at:now()})}));
    await this.db.serviceRest(`/rest/v1/brand_assets?tenant_id=eq.${q(tenantId)}&id=eq.${q(assetId)}`,{method:'PATCH',headers:jsonHeaders,body:jsonBody({index_status:result.status==='INDEXED'?'indexed':result.status==='REQUIRES_AI'?'requires_ai':'failed',updated_at:now()})});
    return{ingestion:updated,chunks:result.chunks.length,knowledgeCreated:result.status==='INDEXED'};
  }

  async knowledgeSources(token:string,tenantId:string){await this.db.requireTenantRole(token,tenantId);const sources=await this.db.userRest<Array<Record<string,unknown>>>(token,`/rest/v1/knowledge_sources?select=*&tenant_id=eq.${q(tenantId)}&order=observed_at.desc`);const facts=await this.db.userRest<Array<Record<string,unknown>>>(token,`/rest/v1/knowledge_facts?select=*&tenant_id=eq.${q(tenantId)}&order=valid_from.desc`);return{sources,facts};}

  private async download(bucket:string,path:string){const response=await fetch(`${this.db.config.url}/storage/v1/object/${q(bucket)}/${pathEncode(path)}`,{headers:{apikey:this.db.config.serviceRoleKey,authorization:`Bearer ${this.db.config.serviceRoleKey}`}});if(!response.ok)throw new Error(`storage_download_${response.status}`);return Buffer.from(await response.arrayBuffer());}
  private first<T>(rows:T[],message='row_not_found'){const row=rows[0];if(!row)throw new Error(message);return row;}
}
