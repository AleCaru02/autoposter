import { createHash } from 'node:crypto';
import type { AIErrorCode, AIExecutionPolicy, AICapability, AIOutputSchema, AIProvider } from '@socialpilot/contracts';

export type MockAIScenario='success'|'timeout'|'malformed'|'validation'|'rate_limit'|'unavailable'|'safety'|'empty'|'partial'|'cost_limit';
type FailureScenario=Exclude<MockAIScenario,'success'>;

export class AIProviderError extends Error {
  constructor(readonly code:AIErrorCode,message:string=code){super(message);this.name='AIProviderError';}
}

const scenarioCodes:Record<FailureScenario,AIErrorCode>={
  timeout:'TIMEOUT',malformed:'MALFORMED_OUTPUT',validation:'VALIDATION_FAILURE',rate_limit:'RATE_LIMIT',unavailable:'PROVIDER_UNAVAILABLE',safety:'SAFETY_REJECTION',empty:'EMPTY_RESPONSE',partial:'PARTIAL_RESPONSE',cost_limit:'COST_LIMIT',
};
const codeForScenario=(scenario:FailureScenario):AIErrorCode=>scenarioCodes[scenario];

const digestVector=(text:string,dimensions=8):number[]=>{
  const hash=createHash('sha256').update(text).digest();
  return Array.from({length:dimensions},(_,index)=>((hash[index]??0)/255)*2-1);
};

export class MockAIProvider implements AIProvider {
  readonly key='mock-openai';
  private scenario:MockAIScenario='success';
  private structuredFixture:unknown={};
  private attempts=0;
  private readonly supported=new Set<AICapability>(['TEXT_CHEAP','TEXT_STANDARD','TEXT_REASONING','STRUCTURED_OUTPUT','EMBEDDING','VISION','IMAGE_GENERATION','IMAGE_EDIT','WEB_RESEARCH']);

  setScenario(value:MockAIScenario){this.scenario=value;this.attempts=0;}
  setStructuredFixture(value:unknown){this.structuredFixture=value;}
  get attemptCount(){return this.attempts;}
  supports(capability:AICapability){return this.supported.has(capability);}

  async generateText(input:{capability:AICapability;prompt:string;policy:AIExecutionPolicy}){
    this.beforeCall(input.policy);
    if(!this.supports(input.capability))throw new AIProviderError('PROVIDER_UNAVAILABLE','capability_unavailable');
    if(this.scenario==='empty')return{text:'',usage:{inputTokens:12,outputTokens:0}};
    if(this.scenario==='partial')throw new AIProviderError('PARTIAL_RESPONSE');
    return{text:`MOCK:${input.capability}:${input.prompt.slice(0,120)}`,usage:{inputTokens:12,outputTokens:24,cachedInputTokens:0}};
  }

  async generateStructured<T>(input:{capability:AICapability;prompt:string;schema:AIOutputSchema<T>;policy:AIExecutionPolicy}):Promise<T>{
    this.beforeCall(input.policy);
    if(this.scenario==='malformed')throw new AIProviderError('MALFORMED_OUTPUT');
    if(this.scenario==='validation')throw new AIProviderError('VALIDATION_FAILURE');
    const parsed=input.schema.safeParse(this.structuredFixture);
    if(!parsed.success)throw new AIProviderError('VALIDATION_FAILURE',parsed.error.message);
    return parsed.data;
  }

  async embed(input:{texts:string[];policy:AIExecutionPolicy}){this.beforeCall(input.policy);return input.texts.map((text)=>digestVector(text));}
  async analyzeVision(input:{prompt:string;images:Array<{url?:string;dataBase64?:string}>;policy:AIExecutionPolicy}){this.beforeCall(input.policy);return{summary:`MOCK_VISION:${input.prompt.slice(0,80)}`,imageCount:input.images.length,objects:['fixture-subject'],confidence:0.88};}
  async generateImage(input:{prompt:string;aspectRatio:'square'|'portrait'|'landscape';policy:AIExecutionPolicy}){this.beforeCall(input.policy);return{dataBase64:Buffer.from(`mock-image:${input.aspectRatio}:${input.prompt}`).toString('base64'),mimeType:'image/png'};}
  async editImage(input:{prompt:string;imageBase64:string;maskBase64?:string;policy:AIExecutionPolicy}){this.beforeCall(input.policy);return{dataBase64:Buffer.from(`mock-edit:${input.prompt}:${input.imageBase64.slice(0,16)}:${input.maskBase64?.slice(0,8)??''}`).toString('base64'),mimeType:'image/png'};}
  async webResearch(input:{query:string;policy:AIExecutionPolicy}){this.beforeCall(input.policy);return{summary:`MOCK_RESEARCH:${input.query}`,sources:[{url:'https://fixture.invalid/source',title:'Fixture source'}]};}

  private beforeCall(policy:AIExecutionPolicy){
    this.attempts+=1;
    if(policy.maxCostMicrounits!==undefined&&policy.maxCostMicrounits===0)throw new AIProviderError('COST_LIMIT');
    if(this.scenario==='success'||this.scenario==='empty'||this.scenario==='partial'||this.scenario==='malformed'||this.scenario==='validation')return;
    throw new AIProviderError(codeForScenario(this.scenario));
  }
}

export const executeAIWithPolicy=async<T>(policy:AIExecutionPolicy,operation:()=>Promise<T>):Promise<T>=>{
  let last:unknown;
  for(let attempt=1;attempt<=policy.maxAttempts;attempt+=1){
    try{
      const timeout=new Promise<never>((_,reject)=>setTimeout(()=>reject(new AIProviderError('TIMEOUT')),policy.timeoutMs));
      return await Promise.race([operation(),timeout]);
    }catch(error){
      last=error;
      const code=error instanceof AIProviderError?error.code:null;
      const retryable=code!==null&&policy.retryableErrors.includes(code);
      if(!retryable||attempt>=policy.maxAttempts)throw error;
    }
  }
  throw last instanceof Error?last:new Error('AI_EXECUTION_FAILED');
};
