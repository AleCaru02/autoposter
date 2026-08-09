export type ModelTier = 'simple' | 'medium' | 'complex' | 'image' | 'embedding';

export interface ModelRouteConfig {
  task: string;
  tier: ModelTier;
  modelConfigKey: string;
  fallbackConfigKey?: string;
  webSearchAllowed: boolean;
  imageGenerationAllowed: boolean;
}

export interface RoutingContext {
  risk: 'low' | 'medium' | 'high';
  budgetState: 'normal' | 'soft_limit' | 'hard_limit';
}

export interface ResolvedModelRoute extends ModelRouteConfig {
  selectedConfigKey: string;
  downgradedForBudget: boolean;
}

export class ConfigModelRouter {
  private readonly routes: Map<string, ModelRouteConfig>;

  constructor(routes: readonly ModelRouteConfig[]) {
    this.routes = new Map(routes.map((route) => [route.task, route]));
  }

  resolve(task: string, context: RoutingContext): ResolvedModelRoute {
    const route = this.routes.get(task);
    if (!route) throw new Error(`MODEL_ROUTE_NOT_CONFIGURED:${task}`);

    if (context.budgetState === 'hard_limit' && route.tier !== 'simple') {
      throw new Error(`AI_BUDGET_HARD_LIMIT:${task}`);
    }

    const canDowngrade = context.risk !== 'high' && context.budgetState === 'soft_limit' && route.fallbackConfigKey;
    return {
      ...route,
      selectedConfigKey: canDowngrade ? route.fallbackConfigKey! : route.modelConfigKey,
      downgradedForBudget: Boolean(canDowngrade),
    };
  }
}
