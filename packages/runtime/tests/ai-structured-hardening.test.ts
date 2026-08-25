import { describe,expect,it } from 'vitest';
import type { ZodType } from 'zod';
import { MockAIProvider } from '../src/ai-provider-mock.js';
import {
  BrandIntelligenceOutputSchema,CaptionOutputSchema,ContentStrategyOutputSchema,CoreConceptOutputSchema,DocumentIntelligenceOutputSchema,
  FactCheckOutputSchema,PlatformVariantOutputSchema,QAOutputSchema,VisualBriefOutputSchema,
} from '@socialpilot/contracts/provider-readiness';
import type { AIExecutionPolicy } from '@socialpilot/contracts';

const policy:AIExecutionPolicy={timeoutMs:100,maxAttempts:2,retryableErrors:['TIMEOUT','RATE_LIMIT','PROVIDER_UNAVAILABLE']};
const evidence={sourceType:'DOCUMENT' as const,sourceId:'asset-1',confidence:.9,confirmed:true,observedAt:'2026-08-10T20:00:00.000Z'};

type StructuredCase={name:string;run:(provider:MockAIProvider)=>Promise<void>};
const structuredCase=(name:string,schema:ZodType<unknown>,fixture:unknown):StructuredCase=>({
  name,
  run:async(provider)=>{
    provider.setStructuredFixture(fixture);
    const output=await provider.generateStructured({capability:'STRUCTURED_OUTPUT',prompt:name,schema,policy});
    expect(schema.safeParse(output).success).toBe(true);
  },
});

const cases:StructuredCase[]=[
  structuredCase('Brand Intelligence',BrandIntelligenceOutputSchema,{brandName:'Brand',industry:'Hospitality',description:'Test',services:['service'],products:['product'],audiences:['audience'],differentiators:['quality'],toneRules:['clear'],allowedClaims:['claim'],forbiddenClaims:['forbidden'],evidence:[evidence]}),
  structuredCase('Strategy',ContentStrategyOutputSchema,{objectives:['awareness'],pillars:[{name:'Education',description:'Teach',targetShare:.5}],platformStrategy:{instagram:'visual'},cadence:{postsPerWeek:3}}),
  structuredCase('Core Concept',CoreConceptOutputSchema,{topic:'topic',angle:'angle',objective:'awareness',hookIntent:'hook',ctaIntent:'cta',claims:[{claim:'claim',evidence:[evidence]}]}),
  structuredCase('Platform Variant',PlatformVariantOutputSchema,{platform:'instagram',decision:'native_variant',format:'image',hook:'hook',caption:'caption',cta:'cta',hashtags:['#tag'],altText:'alt',visualBrief:{subject:'product'},approvalMode:'manual'}),
  structuredCase('Caption',CaptionOutputSchema,{caption:'caption',hashtags:['#tag'],cta:'cta',altText:'alt'}),
  structuredCase('Visual Brief',VisualBriefOutputSchema,{visualType:'photo',subject:'pizza',composition:'centered',textOverlay:[],assetHints:['food'],avoid:['distortion']}),
  structuredCase('QA',QAOutputSchema,{pass:true,score:.92,issues:[]}),
  structuredCase('Fact Check',FactCheckOutputSchema,{pass:true,claims:[{claim:'claim',status:'SUPPORTED',confidence:.92,evidence:[evidence]}]}),
  structuredCase('Document Intelligence',DocumentIntelligenceOutputSchema,{documentType:'price-list',summary:'summary',services:['service'],products:['product'],prices:[{label:'service',value:'100 EUR'}],faqs:[{question:'Q?',answer:'A'}],claims:[{claim:'claim',confidence:.9}],requiresAi:false}),
];

describe('critical AI structured output hardening',()=>{
  for(const testCase of cases){
    it(`${testCase.name} validates through the provider contract`,async()=>{await testCase.run(new MockAIProvider());});
  }
  it('Embeddings contract is stable',async()=>{const provider=new MockAIProvider();const value=await provider.embed({texts:['one','two'],policy});expect(value).toHaveLength(2);expect(value[0]?.length).toBeGreaterThan(0);expect(value[0]?.every(Number.isFinite)).toBe(true);});
  it('Vision contract is stable',async()=>{const provider=new MockAIProvider();const value=await provider.analyzeVision({prompt:'inspect',images:[{url:'https://fixture.invalid/image.jpg'}],policy});expect(value).toMatchObject({imageCount:1});});
  it('Image Generation contract is stable',async()=>{const provider=new MockAIProvider();const value=await provider.generateImage({prompt:'product photo',aspectRatio:'square',policy});expect(value.mimeType).toBe('image/png');expect(value.dataBase64.length).toBeGreaterThan(0);});
  it('Image Edit contract is stable',async()=>{const provider=new MockAIProvider();const value=await provider.editImage({prompt:'crop only',imageBase64:'YWJj',policy});expect(value.mimeType).toBe('image/png');expect(value.dataBase64.length).toBeGreaterThan(0);});
});
