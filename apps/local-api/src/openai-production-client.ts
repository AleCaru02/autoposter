import { AiBudgetManager, type AiModelTier } from './ai-budget-manager.js';
import { currentAiTenantId } from './ai-request-context.js';

const OPENAI_BASE_URL='https://api.openai.com/v1';
const DEFAULT_TEXT_MODEL='gpt-5.6-terra';
const REQUIRED_IMAGE_MODEL='gpt-image-2';

interface ResponseContent { type?:string; text?:string; }
interface ResponseItem { type?:string; content?:ResponseContent[]; }
interface ResponsesBody { id?:string; model?:string; output?:ResponseItem[]; usage?:Record<string,unknown>; error?:{message?:string;code?:string}; }
interface ImageBody { data?:Array<{b64_json?:string;revised_prompt?:string}>; usage?:Record<string,unknown>; error?:{message?:string;code?:string}; }
export interface AiCallContext { tenantId:string; task:string; retryCount?:number; forceTier?:Exclude<AiModelTier,'image'>; }

const stripJsonFence=(value:string)=>value.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();
const inferTask=(instruction:string)=>{
  const lower=instruction.toLowerCase();
  if(lower.includes('brand profile'))return'brand_refinement';
  if(lower.includes('social media strategy'))return'strategy';
  if(lower.includes('content calendar'))return'calendar';
  if(lower.includes('platform-native social content'))return'post_generation';
  if(lower.includes('operational assistant'))return'assistant';
  if(lower.includes('classif')||lower.includes('categor'))return'classification';
  if(lower.includes('quality')||lower.includes('qa'))return'qa';
  return'text_generation';
};
const retryFromInput=(input:unknown)=>{
  if(!input||typeof input!=='object'||Array.isArray(input))return 0;
  const raw=(input as Record<string,unknown>).differentiationAttempt;
  const attempt=Number(raw??1);
  return Number.isFinite(attempt)?Math.max(0,Math.floor(attempt)-1):0;
};

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

  async json<T>(instruction:string,input:unknown,context?:AiCallContext):Promise<{value:T;model:string;responseId:string|null;usage:Record<string,unknown>}> {
    this.assertConfigured();
    const resolved=this.resolveContext(instruction,input,context);
    const prompt=[instruction,'Return ONLY valid JSON. Do not use markdown fences. Do not add facts that are not supported by the supplied data.','INPUT:',JSON.stringify(input)].join('\n\n');
    const reservation=await this.budget.reserveText({tenantId:resolved.tenantId,task:resolved.task,promptInput:prompt,retryCount:resolved.retryCount,forceTier:resolved.forceTier});
    try{
      const body=await this.post<ResponsesBody>('/responses',{model:reservation.model,input:prompt});
      await this.budget.settle(reservation,body.usage??{});
      const text=(body.output??[]).flatMap((item)=>item.content??[]).filter((item)=>item.type==='output_text'||item.type==='text'||Boolean(item.text)).map((item)=>item.text??'').join('').trim();
      if(!text)throw new Error('OPENAI_EMPTY_RESPONSE');
      try{return{value:JSON.parse(stripJsonFence(text)) as T,model:body.model??reservation.model,responseId:body.id??null,usage:body.usage??{}};}
      catch{throw new Error('OPENAI_INVALID_JSON');}
    }catch(error){await this.budget.release(reservation,error).catch(()=>undefined);throw error;}
  }

  async text(instruction:string,input:unknown,context?:AiCallContext):Promise<{text:string;model:string;responseId:string|null;usage:Record<string,unknown>}> {
    this.assertConfigured();
    const resolved=this.resolveContext(instruction,input,context);
    const prompt=[instruction,'Use only the supplied facts. If information is missing, say so explicitly.','INPUT:',JSON.stringify(input)].join('\n\n');
    const reservation=await this.budget.reserveText({tenantId:resolved.tenantId,task:resolved.task,promptInput:prompt,retryCount:resolved.retryCount,forceTier:resolved.forceTier});
    try{
      const body=await this.post<ResponsesBody>('/responses',{model:reservation.model,input:prompt});
      await this.budget.settle(reservation,body.usage??{});
      const text=(body.output??[]).flatMap((item)=>item.content??[]).filter((item)=>item.type==='output_text'||item.type==='text'||Boolean(item.text)).map((item)=>item.text??'').join('').trim();
      if(!text)throw new Error('OPENAI_EMPTY_RESPONSE');
      return{text,model:body.model??reservation.model,responseId:body.id??null,usage:body.usage??{}};
    }catch(error){await this.budget.release(reservation,error).catch(()=>undefined);throw error;}
  }

  async image(prompt:string,size:'1024x1024'|'1024x1536'|'1536x1024'='1024x1536',context?:AiCallContext):Promise<{bytes:Buffer;mimeType:'image/png';model:'gpt-image-2';revisedPrompt:string|null;usage:Record<string,unknown>}> {
    this.assertConfigured();
    const resolved=context??this.resolveContext('image generation',{},undefined,'image_generation');
    const reservation=await this.budget.reserveImage({tenantId:resolved.tenantId,task:resolved.task,size,count:1});
    try{
      const body=await this.post<ImageBody>('/images/generations',{model:REQUIRED_IMAGE_MODEL,prompt,size,n:1});
      await this.budget.settle(reservation,body.usage??{});
      const item=body.data?.[0];
      if(!item?.b64_json)throw new Error('OPENAI_IMAGE_EMPTY_RESPONSE');
      return{bytes:Buffer.from(item.b64_json,'base64'),mimeType:'image/png',model:REQUIRED_IMAGE_MODEL,revisedPrompt:item.revised_prompt??null,usage:body.usage??{}};
    }catch(error){await this.budget.release(reservation,error).catch(()=>undefined);throw error;}
  }

  private resolveContext(instruction:string,input:unknown,context?:AiCallContext,forcedTask?:string):AiCallContext{
    if(context)return context;
    const tenantId=currentAiTenantId();
    if(!tenantId)throw new Error('AI_BUDGET_CONTEXT_REQUIRED');
    return{tenantId,task:forcedTask??inferTask(instruction),retryCount:retryFromInput(input)};
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
