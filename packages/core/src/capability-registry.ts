export type ModelCapability = 'TEXT_CHEAP'|'TEXT_STANDARD'|'TEXT_REASONING'|'STRUCTURED_OUTPUT'|'EMBEDDING'|'VISION'|'IMAGE_GENERATION'|'IMAGE_EDIT'|'WEB_RESEARCH';

export interface CapabilityBinding {
  capability: ModelCapability;
  modelConfigKey: string;
  fallbackConfigKey?: string;
  enabled: boolean;
  maxCostMicrounits?: number;
}

export interface TaskCapabilityRoute {
  task: string;
  capability: ModelCapability;
  fallbackCapability?: ModelCapability;
  risk: 'low'|'medium'|'high';
}

export interface CapabilityResolution {
  task: string;
  capability: ModelCapability;
  selectedConfigKey: string;
  downgraded: boolean;
}

export class ModelCapabilityRegistry {
  private readonly bindings = new Map<ModelCapability,CapabilityBinding>();
  private readonly routes = new Map<string,TaskCapabilityRoute>();

  constructor(bindings:readonly CapabilityBinding[],routes:readonly TaskCapabilityRoute[]) {
    for (const binding of bindings) this.bindings.set(binding.capability,{...binding});
    for (const route of routes) this.routes.set(route.task,{...route});
  }

  resolve(task:string,context:{budgetState:'normal'|'soft_limit'|'hard_limit';estimatedCostMicrounits?:number}):CapabilityResolution {
    const route=this.routes.get(task);
    if(!route) throw new Error(`AI_TASK_CAPABILITY_NOT_CONFIGURED:${task}`);
    let capability=route.capability;
    let downgraded=false;
    if(context.budgetState==='hard_limit') throw new Error(`AI_BUDGET_HARD_LIMIT:${task}`);
    if(context.budgetState==='soft_limit'&&route.risk!=='high'&&route.fallbackCapability){capability=route.fallbackCapability;downgraded=true;}
    const binding=this.bindings.get(capability);
    if(!binding||!binding.enabled) throw new Error(`AI_CAPABILITY_UNAVAILABLE:${capability}`);
    if(binding.maxCostMicrounits!==undefined&&context.estimatedCostMicrounits!==undefined&&context.estimatedCostMicrounits>binding.maxCostMicrounits) throw new Error(`AI_CAPABILITY_COST_LIMIT:${capability}`);
    return{task,capability,selectedConfigKey:binding.modelConfigKey,downgraded};
  }

  supports(capability:ModelCapability):boolean { return this.bindings.get(capability)?.enabled===true; }
  configuredCapabilities():ModelCapability[] { return [...this.bindings.values()].filter((item)=>item.enabled).map((item)=>item.capability); }
}

export const defaultTaskCapabilities:TaskCapabilityRoute[]=[
  {task:'brand_intelligence',capability:'STRUCTURED_OUTPUT',fallbackCapability:'TEXT_STANDARD',risk:'medium'},
  {task:'content_strategy',capability:'TEXT_REASONING',fallbackCapability:'TEXT_STANDARD',risk:'medium'},
  {task:'topic_research',capability:'WEB_RESEARCH',fallbackCapability:'TEXT_STANDARD',risk:'medium'},
  {task:'core_concept',capability:'STRUCTURED_OUTPUT',fallbackCapability:'TEXT_STANDARD',risk:'low'},
  {task:'platform_variant',capability:'STRUCTURED_OUTPUT',fallbackCapability:'TEXT_STANDARD',risk:'low'},
  {task:'qa',capability:'TEXT_REASONING',fallbackCapability:'TEXT_STANDARD',risk:'high'},
  {task:'fact_check',capability:'WEB_RESEARCH',fallbackCapability:'TEXT_REASONING',risk:'high'},
  {task:'embedding',capability:'EMBEDDING',risk:'low'},
  {task:'vision',capability:'VISION',risk:'medium'},
  {task:'image_generation',capability:'IMAGE_GENERATION',risk:'low'},
  {task:'image_edit',capability:'IMAGE_EDIT',risk:'low'},
  {task:'document_intelligence',capability:'STRUCTURED_OUTPUT',fallbackCapability:'TEXT_STANDARD',risk:'medium'},
];
