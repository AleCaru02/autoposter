import { describe,expect,it } from 'vitest';
import { ModelCapabilityRegistry, defaultTaskCapabilities } from '../src/capability-registry.js';

const bindings=[
  {capability:'TEXT_STANDARD' as const,modelConfigKey:'ai.text.standard',enabled:true},
  {capability:'TEXT_REASONING' as const,modelConfigKey:'ai.text.reasoning',enabled:true},
  {capability:'STRUCTURED_OUTPUT' as const,modelConfigKey:'ai.structured',enabled:true},
  {capability:'EMBEDDING' as const,modelConfigKey:'ai.embedding',enabled:true},
  {capability:'VISION' as const,modelConfigKey:'ai.vision',enabled:true},
  {capability:'IMAGE_GENERATION' as const,modelConfigKey:'ai.image.generate',enabled:true},
  {capability:'IMAGE_EDIT' as const,modelConfigKey:'ai.image.edit',enabled:true},
  {capability:'WEB_RESEARCH' as const,modelConfigKey:'ai.web.research',enabled:true},
];

describe('ModelCapabilityRegistry',()=>{
  it('routes business tasks to capabilities/config keys rather than model strings',()=>{const registry=new ModelCapabilityRegistry(bindings,defaultTaskCapabilities);const route=registry.resolve('brand_intelligence',{budgetState:'normal'});expect(route.capability).toBe('STRUCTURED_OUTPUT');expect(route.selectedConfigKey).toBe('ai.structured');expect(route.selectedConfigKey).not.toMatch(/^gpt-|^text-embedding-/);});
  it('downgrades non-high-risk task by capability under soft budget',()=>{const registry=new ModelCapabilityRegistry(bindings,defaultTaskCapabilities);expect(registry.resolve('content_strategy',{budgetState:'soft_limit'})).toMatchObject({capability:'TEXT_STANDARD',downgraded:true});});
  it('does not silently downgrade high-risk fact checking',()=>{const registry=new ModelCapabilityRegistry(bindings,defaultTaskCapabilities);expect(registry.resolve('fact_check',{budgetState:'soft_limit'})).toMatchObject({capability:'WEB_RESEARCH',downgraded:false});});
  it('blocks hard budget and missing capabilities',()=>{const registry=new ModelCapabilityRegistry(bindings,defaultTaskCapabilities);expect(()=>registry.resolve('content_strategy',{budgetState:'hard_limit'})).toThrow('AI_BUDGET_HARD_LIMIT');const missing=new ModelCapabilityRegistry(bindings.filter((item)=>item.capability!=='VISION'),defaultTaskCapabilities);expect(()=>missing.resolve('vision',{budgetState:'normal'})).toThrow('AI_CAPABILITY_UNAVAILABLE:VISION');});
});
