/**
 * Process graph validation (delta v1.1 R5.1).
 *
 * A planted-fault spec must produce validation failures, not a silent bad graph
 * (R5.7). So these rules fail loudly and name the offending element — an
 * authoritative-looking diagram built from broken material is worse than no
 * diagram, because a reader cannot tell the difference.
 */
import {
  allNodeIds,
  processGraphSchema,
  changeSetSchema,
  opportunitySetSchema,
  type ChangeSet,
  type OpportunitySet,
  type ProcessGraph,
} from './schema';

export interface GraphValidation {
  ok: boolean;
  errors: string[];
}

/** Structural rules from R5.1, beyond what the Zod shape can express. */
export function validateGraph(input: unknown): GraphValidation {
  const parsed = processGraphSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    };
  }

  const graph = parsed.data;
  const errors: string[] = [];
  const nodes = allNodeIds(graph);
  const laneIds = new Set(graph.lanes.map((l) => l.id));

  // Exactly one start event.
  const starts = graph.events.filter((e) => e.type === 'start');
  if (starts.length !== 1) {
    errors.push(`Expected exactly one start event, found ${starts.length}.`);
  }

  // At least one end event.
  if (!graph.events.some((e) => e.type === 'end')) {
    errors.push('Expected at least one end event, found none.');
  }

  // Every flow references existing nodes.
  for (const f of graph.flows) {
    if (!nodes.has(f.from)) errors.push(`Flow ${f.id} starts at unknown node "${f.from}".`);
    if (!nodes.has(f.to)) errors.push(`Flow ${f.id} ends at unknown node "${f.to}".`);
  }

  // Every gateway has at least two outgoing flows — a fork that never forks is
  // not a decision, it is a mislabelled step.
  for (const g of graph.gateways) {
    const outgoing = graph.flows.filter((f) => f.from === g.id).length;
    if (outgoing < 2) {
      errors.push(`Gateway ${g.id} has ${outgoing} outgoing flow(s); at least 2 required.`);
    }
  }

  // No orphan nodes: everything except the start event must be reachable by a flow.
  const startId = starts[0]?.id;
  for (const id of nodes) {
    if (id === startId) continue;
    const connected = graph.flows.some((f) => f.from === id || f.to === id);
    if (!connected) errors.push(`Node ${id} is an orphan — no flow connects it.`);
  }
  if (startId && !graph.flows.some((f) => f.from === startId)) {
    errors.push(`Start event ${startId} has no outgoing flow.`);
  }

  // Lane references must resolve.
  for (const n of [...graph.events, ...graph.activities, ...graph.gateways]) {
    if (!laneIds.has(n.laneId)) {
      errors.push(`Node ${n.id} references unknown lane "${n.laneId}".`);
    }
  }

  // Annotations must attach to a real node and cite a facet.
  for (const a of graph.annotations) {
    if (!nodes.has(a.targetId)) {
      errors.push(`Annotation ${a.id} targets unknown node "${a.targetId}".`);
    }
  }

  // Boundary events must be attached to something.
  for (const e of graph.events) {
    if (e.type === 'boundary' && !e.attachedTo) {
      errors.push(`Boundary event ${e.id} is not attached to an activity.`);
    }
    if (e.attachedTo && !nodes.has(e.attachedTo)) {
      errors.push(`Boundary event ${e.id} is attached to unknown node "${e.attachedTo}".`);
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * R5.4: every change must resolve at least one *existing* bottleneck annotation.
 * The Zod shape enforces "at least one id"; this enforces that the id is real.
 */
export function validateChangeSet(input: unknown, graph: ProcessGraph): GraphValidation {
  const parsed = changeSetSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    };
  }

  const changeSet: ChangeSet = parsed.data;
  const errors: string[] = [];
  const annotationIds = new Set(graph.annotations.map((a) => a.id));

  for (const [i, c] of changeSet.changes.entries()) {
    for (const id of c.resolvesAnnotationId) {
      if (!annotationIds.has(id)) {
        errors.push(`Change ${i} ("${c.target}") resolves unknown annotation "${id}".`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * R5.5: no classification without cited evidence. An `unclassified` label is the
 * honest outcome when evidence is thin, and must still explain itself.
 */
export function validateOpportunities(input: unknown, graph: ProcessGraph): GraphValidation {
  const parsed = opportunitySetSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    };
  }

  const set: OpportunitySet = parsed.data;
  const errors: string[] = [];
  const activityIds = new Set(graph.activities.map((a) => a.id));

  for (const c of set.classifications) {
    if (!activityIds.has(c.activityId)) {
      errors.push(`Classification targets unknown activity "${c.activityId}".`);
    }
    if (c.label !== 'unclassified' && c.evidence.length === 0) {
      errors.push(
        `Activity ${c.activityId} is labelled ${c.label} with no cited evidence — label it unclassified and say why instead.`,
      );
    }
  }

  return { ok: errors.length === 0, errors };
}
