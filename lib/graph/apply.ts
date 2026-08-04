/**
 * Applying a change-set to produce the to-be graph (delta v1.1 R5.4).
 *
 * Pure and deterministic. The to-be graph is *derived* from the as-is graph plus
 * the change-set, exactly as the BPMN XML is derived from a graph — there is no
 * second hand-built graph anywhere, so the to-be can never drift from what the
 * change-set says.
 *
 * The result carries `changedIds` alongside the graph rather than flagging nodes
 * inside it, so the returned value is still a plain `ProcessGraph` that
 * `validateGraph` applies to unchanged. The renderer uses the set to style
 * changed elements distinctly (R5.4: a reader must tell changed from unchanged
 * without reading labels).
 */
import { validateGraph } from './validate';
import type { Change, ChangeSet, Flow, ProcessGraph } from './schema';

export interface AppliedGraph {
  graph: ProcessGraph;
  /** Node ids the change-set touched, for distinct rendering. */
  changedIds: Set<string>;
  /** Which change produced each touched node, so a badge can name its bottleneck. */
  changeByNode: Map<string, Change>;
  /** Changes that could not be applied, with why. Never silently dropped. */
  skipped: { change: Change; reason: string }[];
}

export class ChangeSetApplicationError extends Error {
  constructor(
    message: string,
    readonly errors: string[],
  ) {
    super(message);
    this.name = 'ChangeSetApplicationError';
  }
}

/** Deterministic flow id, so the same change-set always yields the same graph. */
function flowId(from: string, to: string): string {
  return `f_${from}__${to}`.replace(/[^A-Za-z0-9_]/g, '_');
}

function nodeExists(graph: ProcessGraph, id: string): boolean {
  return (
    graph.events.some((n) => n.id === id) ||
    graph.activities.some((n) => n.id === id) ||
    graph.gateways.some((n) => n.id === id)
  );
}

/** Insert `id` on the edges leaving `after` (or entering `before`). */
function spliceInto(
  flows: Flow[],
  id: string,
  placement: { after?: string; before?: string },
): Flow[] {
  const next = [...flows];

  if (placement.after) {
    const outgoing = next.filter((f) => f.from === placement.after);
    for (const f of outgoing) {
      const i = next.indexOf(f);
      next.splice(i, 1, { ...f, id: flowId(id, f.to), from: id });
    }
    next.push({ id: flowId(placement.after, id), from: placement.after, to: id });
    return next;
  }

  const incoming = next.filter((f) => f.to === placement.before);
  for (const f of incoming) {
    const i = next.indexOf(f);
    next.splice(i, 1, { ...f, id: flowId(f.from, id), to: id });
  }
  next.push({ id: flowId(id, placement.before!), from: id, to: placement.before! });
  return next;
}

/** Remove a node and heal the flow around it, so no gap is left behind. */
function bypass(flows: Flow[], id: string): Flow[] {
  const incoming = flows.filter((f) => f.to === id);
  const outgoing = flows.filter((f) => f.from === id);
  const rest = flows.filter((f) => f.from !== id && f.to !== id);

  for (const i of incoming) {
    for (const o of outgoing) {
      // Preserve the branch condition from whichever side carried one.
      rest.push({
        id: flowId(i.from, o.to),
        from: i.from,
        to: o.to,
        ...(i.condition || o.condition ? { condition: i.condition ?? o.condition } : {}),
      });
    }
  }
  return rest;
}

export function applyChangeSet(graph: ProcessGraph, changeSet: ChangeSet): AppliedGraph {
  // Deep-ish clone: every array is rebuilt, so the as-is graph is never mutated.
  let next: ProcessGraph = {
    ...graph,
    lanes: [...graph.lanes],
    events: graph.events.map((n) => ({ ...n })),
    activities: graph.activities.map((n) => ({ ...n })),
    gateways: graph.gateways.map((n) => ({ ...n })),
    flows: graph.flows.map((f) => ({ ...f })),
    annotations: graph.annotations.map((a) => ({ ...a })),
  };

  const changedIds = new Set<string>();
  const changeByNode = new Map<string, Change>();
  const skipped: { change: Change; reason: string }[] = [];

  for (const change of changeSet.changes) {
    const place = change.placement ?? {};

    switch (change.op) {
      case 'add': {
        if (nodeExists(next, change.target)) {
          skipped.push({ change, reason: `a node "${change.target}" already exists` });
          break;
        }
        const anchor = place.after ?? place.before;
        if (!anchor || !nodeExists(next, anchor)) {
          skipped.push({
            change,
            reason: `add needs placement.after or placement.before naming an existing node (got "${anchor ?? 'nothing'}")`,
          });
          break;
        }
        const laneId = place.laneId ?? next.activities.find((a) => a.id === anchor)?.laneId ?? next.lanes[0]?.id;
        if (!laneId) {
          skipped.push({ change, reason: 'the graph has no lane to place the node in' });
          break;
        }
        next.activities.push({
          id: change.target,
          name: place.name ?? change.description.slice(0, 80),
          laneId,
          systems: [],
          // Provenance of a proposed step is the bottleneck's facet — it exists
          // because of that evidence, and nothing else.
          sourceFacet:
            next.annotations.find((a) => a.id === change.resolvesAnnotationId[0])?.evidence.facet ?? 5,
        });
        next.flows = spliceInto(next.flows, change.target, place);
        changedIds.add(change.target);
        changeByNode.set(change.target, change);
        break;
      }

      case 'remove': {
        if (!nodeExists(next, change.target)) {
          skipped.push({ change, reason: `no node "${change.target}" to remove` });
          break;
        }
        next.flows = bypass(next.flows, change.target);
        next.events = next.events.filter((n) => n.id !== change.target);
        next.activities = next.activities.filter((n) => n.id !== change.target);
        next.gateways = next.gateways.filter((n) => n.id !== change.target);
        // An annotation whose target is gone would dangle; drop it with the node.
        next.annotations = next.annotations.filter((a) => a.targetId !== change.target);
        break;
      }

      case 'modify': {
        if (!nodeExists(next, change.target)) {
          skipped.push({ change, reason: `no node "${change.target}" to modify` });
          break;
        }
        if (place.name) {
          const act = next.activities.find((a) => a.id === change.target);
          if (act) act.name = place.name;
          const gw = next.gateways.find((g) => g.id === change.target);
          if (gw) gw.name = place.name;
        }
        changedIds.add(change.target);
        changeByNode.set(change.target, change);
        break;
      }

      case 'reorder': {
        if (!nodeExists(next, change.target)) {
          skipped.push({ change, reason: `no node "${change.target}" to reorder` });
          break;
        }
        const anchor = place.after ?? place.before;
        if (!anchor || !nodeExists(next, anchor) || anchor === change.target) {
          skipped.push({
            change,
            reason: `reorder needs placement.after or placement.before naming a different existing node`,
          });
          break;
        }
        // Lift the node out, heal behind it, then splice it back in.
        next.flows = spliceInto(bypass(next.flows, change.target), change.target, place);
        changedIds.add(change.target);
        changeByNode.set(change.target, change);
        break;
      }
    }
  }

  // Deduplicate flows an op may have produced twice (a bypass then a splice).
  const seen = new Set<string>();
  next.flows = next.flows.filter((f) => {
    const key = `${f.from}->${f.to}`;
    if (seen.has(key) || f.from === f.to) return false;
    seen.add(key);
    return true;
  });

  // The to-be graph must be as valid as the as-is one. A change-set that produces
  // an incoherent process is a failure, not a diagram to render with a caveat.
  const check = validateGraph(next);
  if (!check.ok) {
    throw new ChangeSetApplicationError(
      'Applying the change-set produced an invalid process graph.',
      check.errors,
    );
  }

  return { graph: next, changedIds, changeByNode, skipped };
}
