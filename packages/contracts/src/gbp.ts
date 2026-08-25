import { z } from 'zod';

export const GbpContentDecisionSchema = z.object({
  decision: z.enum(['reuse_adapted', 'separate_local_post', 'not_applicable']),
  reason: z.string(),
  localIntent: z.string().optional(),
  postType: z.enum(['standard', 'event', 'offer']).optional(),
  ctaType: z.string().optional(),
});

export type GbpContentDecision = z.infer<typeof GbpContentDecisionSchema>;

export interface GbpLocalOptimizer {
  decide(input: {
    tenantId: string;
    locationId: string;
    coreConcept: Record<string, unknown>;
    businessFacts: Record<string, unknown>;
  }): Promise<GbpContentDecision>;
}
