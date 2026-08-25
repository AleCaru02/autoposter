import { AiBudgetManager, type AiModelTier } from './ai-budget-manager.js';

const OPENAI_BASE_URL='https://api.openai.com/v1';
const DEFAULT_TEXT_MODEL='gpt-5.6-terra';
const REQUIRED_IMAGE_MODEL='gpt-image-2';

interface ResponseContent { type?:string; text?:string; }
interface ResponseItem { type?:string; content?:ResponseContent[]; }
interface ResponsesBody { id?:string; model?:string; output?:ResponseItem[]; usage?:Record<string,unknown>; error?:{message?:string;code?:string}; }
interface ImageBody { data?:Array<{b64_json?:string;revised_prompt?:string}>; usage?:Record<string,unknown>; error?:{message?:string;code?:string}; }
export interface AiCallContext { tenantId:string; task:string; retryCount?:number; forceTier?:Exclude<AiModelTier,'image'>; }

const stripJsonFence=(value:string)=>value.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();

export class OpenAIProductionClient {
  readonly apiKey:string;
  readonly textModel:string;
  readonly imageModel:string;
  private readonly budget:AiBudgetManager;

  constructor(budget=new AiBudgetManager()){
    this.apiKey=(process.env.OPENAI_API_KEY??'').trim();
    this.textModel=(process.env.AI_MODEL_TEXT_STANDARD??process.env.AI_MODEL_STRUCTURED_OUTPUT??DEFAULT_TEXT_MODEL).trim()||DEFAULT_TEXT_MODEL;
    this.imageModel=(process.env.AI_MODEL_IMAGE_GENERATION??REQUIRED_IMAGE_MODEL).trim()||REQUIRED_IMAGE_MODEL;
    this.budget=budget;
  }

  isConfigured(){return Boolean(this.apiKey)&&this.budget.isPricingConfigured();}

  assertConfigured(){
    if(!this.apiKey)throw new Error('OPENAI_NOT_CONFIGURED');
    if(this.imageModel!==REQUIRED_IMAGE_MODEL)throw new Error('OPENAI_IMAGES_MODEL_INVALID');
    if(!this.budget.isPricingConfigured())throw new Error('AI_PRICING_NOT_CONFIGURED');
  }

  async json<T>(instruction:string,input:unknown,context:AiCallContext):Promise<{value:T;model:string;responseId:string|null;usage:Record<string,unknown>}> {
    this.assertConfigured();
    const prompt=[instruction,'Return ONLY valid JSON. Do not use markdown fences. Do not add facts that are not supported by the supplied data.','INPUT:',JSON.stringify(input)].join('\n\n');
    const reservation=await this.budget.reserveText({tenantId:context.tenantId,task:context.task,promptInput:prompt,retryCount:context.retryCount,forceTier:context.forceTier});
    try{
      const body=await this.post<ResponsesBody>('/responses',{model:reservation.model,input:prompt});
      await this.budget.settle(reservation,body.usage??{});
      const text=(body.output??[]).flatMap((item)=>item.content??[]).filter((item)=>item.type==='output_text'||item.type==='text'||Boolean(item.text)).map((item)=>item.text??'').join('').trim();
      if(!text)throw new Error('OPENAI_EMPTY_RESPONSE');
      try{return{value:JSON.parse(stripJsonFence(text)) as T,model:body.model??reservation.model,responseId:body.id??null,usage:body.usage??{}};}
      catch{throw new Error('OPENAI_INVALID_JSON');}
    }catch(error){
      await this.budget.release(reservation,error).catch(()=>undefined);
      throw error;
    }
  }

  async text(instruction:string,input:unknown,context:AiCallContext):Promise<{text:string;model:string;responseId:string|null;usage:Record<string,unknown>}> {
    this.assertConfigured();
    const prompt=[instruction,'Use only the supplied facts. If information is missing, say so explicitly.','INPUT:',JSON.stringify(input)].join('\n\n');
    const reservation=await this.budget.reserveText({tenantId:context.tenantId,task:context.task,promptInput:prompt,retryCount:context.retryCount,forceTier:context.forceTier});
    try{
      const body=await this.post<ResponsesBody>('/responses',{model:reservation.model,input:prompt});
      await this.budget.settle(reservation,body.usage??{});
      const text=(body.output??[]).flatMap((item)=>item.content??[]).filter((item)=>item.type==='output_text'||item.type==='text'||Boolean(item.text)).map((item)=>item.text??'').join('').trim();
      if(!text)throw new Error('OPENAI_EMPTY_RESPONSE');
      return{text,model:body.model??reservation.model,responseId:body.id??null,usage:body.usage??{}};
    }catch(error){
      await this.budget.release(reservation,error).catch(()=>undefined);
      throw error;
    }
  }

  async image(prompt:string,size:'1024x1024'|'1024x1536'|'1536x1024'='1024x1536',context:AiCallContext):Promise<{bytes:Buffer;mimeType:'image/png';model:'gpt-image-2';revisedPrompt:string|null;usage:Record<string,unknown>}> {
    this.assertConfigured();
    const reservation=await this.budget.reserveImage({tenantId:context.tenantId,task:context.task,size,count:1});
    try{
      const body=await this.post<ImageBody>('/images/generations',{model:REQUIRED_IMAGE_MODEL,prompt,size,n:1});
      await this.budget.settle(reservation,body.usage??{});
      const item=body.data?.[0];
      if(!item?.b64_json)throw new Error('OPENAI_IMAGE_EMPTY_RESPONSE');
      return{bytes:Buffer.from(item.b64_json,'base64'),mimeType:'image/png',model:REQUIRED_IMAGE_MODEL,revisedPrompt:item.revised_prompt??null,usage:body.usage??{}};
    }catch(error){
      await this.budget.release(reservation,error).catch(()=>undefined);
      throw error;
    }
  }

  private async post<T extends {error?:{message?:string;code?:string}}>(path:string,payload:Record<string,unknown>):Promise<T>{
    const response=await fetch(`${OPENAI_BASE_URL}${path}`,{method:'POST',headers:{authorization:`Bearer ${this.apiKey}`,'content-type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(120_000)});
    const text=await response.text();
    let body:T;
    try{body=(text?JSON.parse(text):{}) as T;}catch{throw new Error(`OPENAI_HTTP_${response.status}`);}
    if(!response.ok)throw new Error(`OPENAI_HTTP_${response.status}:${body.error?.code??body.error?.message??'request_failed'}`);
    return body;
  }
}

export const OPENAI_IMAGE_MODEL='gpt-image-2' as const;
