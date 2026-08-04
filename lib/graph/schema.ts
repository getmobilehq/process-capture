/**
 * Typed process graph (delta v1.1 R5.1) — the canonical artefact.
 *
 * The model never writes BPMN XML. A dedicated extraction pass converts a
 * completed spec into this graph, and every downstream view (as-is, to-be,
 * opportunity overlay, BPMN export) is a pure function of it. That is P1 applied
 * to diagrams: the model proposes graph content, the server validates the shape.
 *
 * The hard rule is lineage. Every node and annotation carries `sourceFacet`; a
 * diagram element with no facet lineage is invalid, because a diagram that cannot
 * say where a box came from is not evidence — it is decoration.
 */
import { z } from 'zod';

const facetRef = z.number().int().min(1).max(12);
const nodeId = z.string().min(1);

export const laneSchema = z.object({
  id: nodeId,
  name: z.string().min(1),
  sourceFacet: facetRef,
});

export const eventSchema = z.object({
  id: nodeId,
  type: z.enum(['start', 'end', 'boundary']),
  name: z.string().min(1),
  laneId: nodeId,
  sourceFacet: facetRef,
  /** For boundary events: the activity they are attached to. */
  attachedTo: nodeId.optional(),
});

export const activitySchema = z.object({
  id: nodeId,
  name: z.string().min(1),
  laneId: nodeId,
  /** Canonical entity ids from the R2 taxonomy — never free text. */
  systems: z.array(z.string()).default([]),
  sourceFacet: facetRef,
});

export const gatewaySchema = z.object({
  id: nodeId,
  type: z.enum(['exclusive', 'parallel']),
  name: z.string().min(1),
  condition: z.string().default(''),
  laneId: nodeId,
  sourceFacet: facetRef,
});

export const flowSchema = z.object({
  id: nodeId,
  from: nodeId,
  to: nodeId,
  condition: z.string().optional(),
});

export const annotationSchema = z.object({
  id: nodeId,
  targetId: nodeId,
  kind: z.enum(['bottleneck', 'risk', 'metric']),
  text: z.string().min(1),
  evidence: z.object({
    facet: facetRef,
    quote: z.string().optional(),
  }),
  metrics: z.record(z.union([z.string(), z.number()])).optional(),
});

export const processGraphSchema = z.object({
  processId: z.string().min(1),
  name: z.string().min(1),
  specRef: z.string().min(1),
  generatedAt: z.string().min(1),
  lanes: z.array(laneSchema),
  events: z.array(eventSchema),
  activities: z.array(activitySchema),
  gateways: z.array(gatewaySchema),
  flows: z.array(flowSchema),
  annotations: z.array(annotationSchema).default([]),
});

export type Lane = z.infer<typeof laneSchema>;
export type ProcessEvent = z.infer<typeof eventSchema>;
export type Activity = z.infer<typeof activitySchema>;
export type Gateway = z.infer<typeof gatewaySchema>;
export type Flow = z.infer<typeof flowSchema>;
export type Annotation = z.infer<typeof annotationSchema>;
export type ProcessGraph = z.infer<typeof processGraphSchema>;

/** Every node id in the graph, whatever its kind. */
export function allNodeIds(graph: ProcessGraph): Set<string> {
  return new Set([
    ...graph.events.map((n) => n.id),
    ...graph.activities.map((n) => n.id),
    ...graph.gateways.map((n) => n.id),
  ]);
}

// ── Change sets (R5.4) ──────────────────────────────────────────────────────

export const changeSchema = z.object({
  op: z.enum(['add', 'remove', 'modify', 'reorder']),
  target: z.string().min(1),
  description: z.string().min(1),
  /**
   * Hard constraint (R5.4): every change must reference the bottleneck annotation
   * it resolves. A change that resolves nothing is rejected at validation — a
   * to-be diagram is a set of answers to evidenced problems, not a wishlist.
   */
  resolvesAnnotationId: z.array(z.string().min(1)).min(1),
  rationale: z.string().min(1),
  /**
   * Where the change goes. The delta's Change shape carries position only in the
   * prose description ("insert between diagnostics and the decision"), which a
   * mechanical apply cannot act on — so placement is structured alongside it.
   * Optional: `modify` and `remove` locate themselves from `target`.
   */
  placement: z
    .object({
      after: z.string().optional(),
      before: z.string().optional(),
      laneId: z.string().optional(),
      /** Display name for an added node; falls back to the description. */
      name: z.string().optional(),
    })
    .optional(),
});

export const changeSetSchema = z.object({
  baseGraph: z.string().min(1),
  provenance: z.literal('proposed'),
  verified: z.boolean().default(false),
  changes: z.array(changeSchema),
});

export type Change = z.infer<typeof changeSchema>;
export type ChangeSet = z.infer<typeof changeSetSchema>;

// ── Opportunity classification (R5.5) ───────────────────────────────────────

export const opportunitySchema = z.object({
  activityId: nodeId,
  label: z.enum(['automatable', 'assistable', 'human-required', 'unclassified']),
  /**
   * No classification without cited evidence (R5.5). `unclassified` is the honest
   * outcome when evidence is insufficient, and must say why.
   */
  evidence: z.array(facetRef),
  rationale: z.string().min(1),
});

export const opportunitySetSchema = z.object({
  graphRef: z.string().min(1),
  provenance: z.literal('proposed'),
  verified: z.boolean().default(false),
  classifications: z.array(opportunitySchema),
});

export type Opportunity = z.infer<typeof opportunitySchema>;
export type OpportunitySet = z.infer<typeof opportunitySetSchema>;
