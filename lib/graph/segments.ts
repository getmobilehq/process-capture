/**
 * Automation segments (R5.8).
 *
 * Value in automation rarely lands on a single step. It lands on a run of them —
 * "steps four to eight are all system work on data two systems already hold". A
 * stakeholder deciding where to look needs the run, not the step.
 *
 * Segments are derived **here, in server code**, from the graph and the existing
 * per-activity classifications. The model never proposes a segment: it describes
 * ones the graph supports. That keeps P1 intact, and it means every segment can be
 * pointed at on the map — the claim is "these steps, in this order", which is
 * checkable, rather than a grouping a model found persuasive.
 *
 * The rule is deliberately plain, because a segmentation nobody can explain is one
 * nobody can challenge:
 *
 *   A segment is a maximal run of activities that share the same label and are
 *   adjacent — adjacent meaning a flow from one to the next, possibly passing
 *   through gateways or intermediate events, but never through another activity.
 *
 * Runs of different labels are not merged. Where a process alternates, that
 * produces several small segments rather than one large vague one, and the
 * fragmentation is itself the finding: a scattered opportunity is worth less than a
 * contiguous one, and the shape of the list says so without anyone editorialising.
 */
import type { OpportunitySet, ProcessGraph } from './schema';

export type SegmentLabel = 'automatable' | 'assistable' | 'human-required' | 'unclassified';

export interface Segment {
  id: string;
  label: SegmentLabel;
  /** Activity ids in flow order — the thing a reader can point at. */
  activityIds: string[];
  activityNames: string[];
  /** Lanes the run passes through. More than one means a hand-off sits inside it. */
  laneIds: string[];
  crossesLanes: boolean;
  /** Gateways the run passes through. A decision inside a run is material. */
  gatewayIds: string[];
  /** Every system named on any activity in the run. */
  systems: string[];
  /** Facets cited by the classifications underneath, deduplicated and sorted. */
  evidence: number[];
  /** Share of the process's activities this run covers, 0–1. */
  coverage: number;
}

export interface SegmentSignals {
  totalActivities: number;
  classified: number;
  automatable: number;
  assistable: number;
  humanRequired: number;
  unclassified: number;
  /** Share of activities the classifier would not judge. The quality signal. */
  unclassifiedShare: number;
  /** Share that is automatable or assistable — the size of the opportunity. */
  automationShare: number;
  /** Coverage of the single largest automatable or assistable run. */
  largestRunCoverage: number;
  segmentCount: number;
}

const AUTOMATION_LABELS: SegmentLabel[] = ['automatable', 'assistable'];

/**
 * Activity-to-activity adjacency, allowing a path through gateways and
 * intermediate events but never through another activity. Returns, for each
 * activity, the activities directly reachable from it and the gateways passed
 * through on the way.
 */
function activityAdjacency(graph: ProcessGraph): Map<string, { to: string; via: string[] }[]> {
  const activityIds = new Set(graph.activities.map((a) => a.id));
  const out = new Map<string, { to: string; condition?: string }[]>();
  for (const f of graph.flows) {
    out.set(f.from, [...(out.get(f.from) ?? []), { to: f.to, condition: f.condition }]);
  }

  const adjacency = new Map<string, { to: string; via: string[] }[]>();
  for (const a of graph.activities) {
    const found: { to: string; via: string[] }[] = [];
    // Breadth-first through non-activity nodes only. `seen` is per source, so a
    // diamond that rejoins does not re-walk, and a cycle cannot spin.
    const seen = new Set<string>([a.id]);
    const queue: { node: string; via: string[] }[] = (out.get(a.id) ?? []).map((e) => ({
      node: e.to,
      via: [],
    }));

    while (queue.length > 0) {
      const { node, via } = queue.shift()!;
      if (seen.has(node)) continue;
      seen.add(node);

      if (activityIds.has(node)) {
        found.push({ to: node, via });
        continue; // stop at the activity; it is the next segment member, not a waypoint
      }
      const isGateway = graph.gateways.some((g) => g.id === node);
      const nextVia = isGateway ? [...via, node] : via;
      for (const e of out.get(node) ?? []) queue.push({ node: e.to, via: nextVia });
    }
    adjacency.set(a.id, found);
  }
  return adjacency;
}

/** Flow order: longest path from the start, so a run reads the way work happens. */
function flowOrder(graph: ProcessGraph): Map<string, number> {
  const order = new Map<string, number>();
  for (const a of graph.activities) order.set(a.id, 0);
  for (let pass = 0; pass < graph.activities.length; pass += 1) {
    let changed = false;
    for (const f of graph.flows) {
      if (!order.has(f.from) || !order.has(f.to)) continue;
      const next = order.get(f.from)! + 1;
      if (next > order.get(f.to)!) {
        order.set(f.to, next);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return order;
}

export function deriveSegments(graph: ProcessGraph, set: OpportunitySet): Segment[] {
  const labelOf = new Map<string, SegmentLabel>(
    set.classifications.map((c) => [c.activityId, c.label as SegmentLabel]),
  );
  const evidenceOf = new Map<string, number[]>(
    set.classifications.map((c) => [c.activityId, c.evidence]),
  );
  const byId = new Map(graph.activities.map((a) => [a.id, a]));
  const adjacency = activityAdjacency(graph);
  const order = flowOrder(graph);

  // Union-find over "same label and adjacent", so a run is discovered rather than
  // assumed to be linear — real processes fan out and rejoin.
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)!)!);
      x = parent.get(x)!;
    }
    return x;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (const a of graph.activities) parent.set(a.id, a.id);
  for (const a of graph.activities) {
    const mine = labelOf.get(a.id);
    if (!mine) continue;
    for (const { to } of adjacency.get(a.id) ?? []) {
      if (labelOf.get(to) === mine) union(a.id, to);
    }
  }

  const groups = new Map<string, string[]>();
  for (const a of graph.activities) {
    if (!labelOf.has(a.id)) continue;
    const root = find(a.id);
    groups.set(root, [...(groups.get(root) ?? []), a.id]);
  }

  const total = graph.activities.length || 1;
  const segments: Segment[] = [];

  for (const [root, ids] of groups) {
    const members = [...ids].sort(
      (x, y) => (order.get(x) ?? 0) - (order.get(y) ?? 0) || x.localeCompare(y),
    );
    const label = labelOf.get(members[0])!;
    const lanes = [...new Set(members.map((id) => byId.get(id)!.laneId))];
    const gateways = [
      ...new Set(
        members.flatMap((id) =>
          (adjacency.get(id) ?? [])
            .filter((e) => members.includes(e.to))
            .flatMap((e) => e.via),
        ),
      ),
    ];

    segments.push({
      id: `seg:${root.replace(/[^A-Za-z0-9_.-]/g, '_')}`,
      label,
      activityIds: members,
      activityNames: members.map((id) => byId.get(id)!.name),
      laneIds: lanes,
      crossesLanes: lanes.length > 1,
      gatewayIds: gateways.sort(),
      systems: [...new Set(members.flatMap((id) => byId.get(id)!.systems))].sort(),
      evidence: [...new Set(members.flatMap((id) => evidenceOf.get(id) ?? []))].sort(
        (a, b) => a - b,
      ),
      coverage: members.length / total,
    });
  }

  // Biggest opportunity first; automation-relevant runs above the rest, because a
  // reader scanning this list is looking for where to act.
  const rank = (s: Segment) => (AUTOMATION_LABELS.includes(s.label) ? 0 : 1);
  return segments.sort(
    (a, b) => rank(a) - rank(b) || b.coverage - a.coverage || a.id.localeCompare(b.id),
  );
}

export function segmentSignals(graph: ProcessGraph, segments: Segment[]): SegmentSignals {
  const total = graph.activities.length;
  const count = (l: SegmentLabel) =>
    segments.filter((s) => s.label === l).reduce((n, s) => n + s.activityIds.length, 0);

  const automatable = count('automatable');
  const assistable = count('assistable');
  const humanRequired = count('human-required');
  const unclassified = count('unclassified');
  const classified = automatable + assistable + humanRequired + unclassified;

  const runs = segments.filter((s) => AUTOMATION_LABELS.includes(s.label));

  return {
    totalActivities: total,
    classified,
    automatable,
    assistable,
    humanRequired,
    unclassified,
    unclassifiedShare: total === 0 ? 0 : unclassified / total,
    automationShare: total === 0 ? 0 : (automatable + assistable) / total,
    largestRunCoverage: runs.reduce((m, s) => Math.max(m, s.coverage), 0),
    segmentCount: runs.length,
  };
}
