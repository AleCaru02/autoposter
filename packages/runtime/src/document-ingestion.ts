import { createHash } from 'node:crypto';
import type { DocumentChunk, DocumentIngestionProvider } from '@socialpilot/contracts';

const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const normalizeText=(value:string)=>value.replace(/\r/g,'').replace(/[\t ]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();

const printablePdfText=(bytes:Uint8Array):string=>{
  const raw=Buffer.from(bytes).toString('latin1');
  if(!raw.startsWith('%PDF-'))throw new Error('DOCUMENT_CORRUPT_PDF');
  const matches=[...raw.matchAll(/\(([^()]{3,500})\)\s*Tj/g)].map((match)=>match[1]??'');
  const text=normalizeText(matches.join('\n').replace(/\\([()\\])/g,'$1'));
  return text;
};

export class MockDocumentIngestionProvider implements DocumentIngestionProvider {
  readonly key='mock-local';
  private readonly indexed=new Map<string,DocumentChunk[]>();

  async extractText(input:{mimeType:string;bytes:Uint8Array;filename:string}):Promise<string>{
    if(input.bytes.byteLength===0)throw new Error('DOCUMENT_EMPTY');
    if(['text/plain','text/markdown','text/csv','application/json'].includes(input.mimeType))return normalizeText(Buffer.from(input.bytes).toString('utf8'));
    if(input.mimeType==='application/pdf'){
      const extracted=printablePdfText(input.bytes);
      if(!extracted)throw new Error('DOCUMENT_REQUIRES_AI');
      return extracted;
    }
    throw new Error('DOCUMENT_REQUIRES_AI');
  }

  async extractMetadata(input:{mimeType:string;bytes:Uint8Array;filename:string}){
    return{filename:input.filename,mimeType:input.mimeType,bytes:input.bytes.byteLength,parser:this.key,contentHash:createHash('sha256').update(input.bytes).digest('hex')};
  }

  async chunk(input:{text:string;maxChars?:number}):Promise<DocumentChunk[]>{
    const max=Math.max(300,Math.min(input.maxChars??1800,5000));
    const paragraphs=normalizeText(input.text).split(/\n\s*\n/).filter(Boolean);
    const chunks:string[]=[];let current='';
    const flush=()=>{if(current.trim()){chunks.push(current.trim());current='';}};
    for(const paragraph of paragraphs){
      if(paragraph.length>max){flush();for(let i=0;i<paragraph.length;i+=max)chunks.push(paragraph.slice(i,i+max).trim());continue;}
      const candidate=current?`${current}\n\n${paragraph}`:paragraph;
      if(candidate.length>max)flush();
      current=current?`${current}\n\n${paragraph}`:paragraph;
    }
    flush();
    return chunks.map((content,index)=>({index,content,contentHash:hash(content),metadata:{chars:content.length}}));
  }

  async classify(input:{text:string;metadata:Record<string,unknown>}){
    const lower=input.text.toLowerCase();
    const documentType=/€|eur|prezz|price|listino/.test(lower)?'price_list':/faq|domand|question/.test(lower)?'faq':/brochure|serviz|service|product/.test(lower)?'brochure':'document';
    return{documentType,hasPrices:/€|eur|prezz|price/.test(lower),hasFaq:/faq|domand|question/.test(lower),requiresAi:false,metadataKeys:Object.keys(input.metadata)};
  }

  async summarize(input:{text:string;metadata:Record<string,unknown>}){const clean=normalizeText(input.text);return clean.length<=600?clean:`${clean.slice(0,597)}…`;}

  async index(input:{tenantId:string;assetId:string;chunks:DocumentChunk[]}){this.indexed.set(`${input.tenantId}:${input.assetId}`,input.chunks.map((item)=>({...item,metadata:{...item.metadata}})));return{indexed:input.chunks.length};}

  getIndexed(tenantId:string,assetId:string){return this.indexed.get(`${tenantId}:${assetId}`)?.map((item)=>({...item,metadata:{...item.metadata}}))??[];}
}

export interface DocumentIngestionResult {status:'INDEXED'|'REQUIRES_AI'|'FAILED';text?:string;metadata:Record<string,unknown>;classification:Record<string,unknown>;summary?:string;chunks:DocumentChunk[];errorCode?:string;}

export const ingestDocument=async(provider:DocumentIngestionProvider,input:{tenantId:string;assetId:string;mimeType:string;filename:string;bytes:Uint8Array}):Promise<DocumentIngestionResult>=>{
  const metadata=await provider.extractMetadata(input);
  try{
    const text=await provider.extractText(input);
    const chunks=await provider.chunk({text});
    const classification=await provider.classify({text,metadata});
    const summary=await provider.summarize({text,metadata});
    await provider.index({tenantId:input.tenantId,assetId:input.assetId,chunks});
    return{status:'INDEXED',text,metadata,classification,summary,chunks};
  }catch(error){
    const code=error instanceof Error?error.message:'DOCUMENT_INGESTION_FAILED';
    if(code==='DOCUMENT_REQUIRES_AI')return{status:'REQUIRES_AI',metadata,classification:{requiresAi:true},chunks:[],errorCode:code};
    return{status:'FAILED',metadata,classification:{requiresAi:false},chunks:[],errorCode:code};
  }
};
