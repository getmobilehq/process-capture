import { describe, it, expect } from 'vitest';
import { deriveSegments, segmentSignals } from '@/lib/graph/segments';
import type { OpportunitySet, ProcessGraph } from '@/lib/graph/schema';

function graph(over: Partial<ProcessGraph> = {}): ProcessGraph {
  return {
    processId: 'p',
    name: 'P',
    specRef: 's',
    generatedAt: 'n',
    lanes: [
      { id: 'lane:a', name: 'Advisor', sourceFacet: 2 },
      { id: 'lane:b', name: 'Manager', sourceFacet: 2 },
    ],
    events: [
      { id: 'ev:s', type: 'start', name: 'Start', laneId: 'lane:a', sourceFacet: 3 },
      { id: 'ev:e', type: 'end', name: 'End', laneId: 'lane:a', sourceFacet: 1 },
    ],
    activities: [
      { id: 'act:1', name: 'Open record', laneId: 'lane:a', systems: ['CRM'], sourceFacet: 5 },
      { id: 'act:2', name: 'Pull history', laneId: 'lane:a', systems: ['Billing'], sourceFacet: 5 },
      { id: 'act:3', name: 'Approve credit', laneId: 'lane:b', systems: [], sourceFacet: 6 },
      { id: 'act:4', name: 'Close case', laneId: 'lane:a', systems: ['CRM'], sourceFacet: 5 },
    ],
    gateways: [],
    flows: [
      { id: 'f0', from: 'ev:s', to: 'act:1' },
      { id: 'f1', from: 'act:1', to: 'act:2' },
      { id: 'f2', from: 'act:2', to: 'act:3' },
      { id: 'f3', from: 'act:3', to: 'act:4' },
      { id: 'f4', from: 'act:4', to: 'ev:e' },
    ],
    annotations: [],
    ...over,
  };
}

function opps(labels: Record<string, string>, evidence: Record<string, number[]> = {}): OpportunitySet {
  return {
    graphRef: 'p',
    provenance: 'proposed',
    verified: false,
    classifications: Object.entries(labels).map(([activityId, label]) => ({
      activityId,
      label: label as never,
      evidence: evidence[activityId] ?? [8],
      rationale: 'because',
    })),
  };
}

describe('automation segments (R5.8)', () => {
  it('groups an adjacent run that shares a label', () => {
    const segs = deriveSegments(
      graph(),
      opps({ 'act:1': 'automatable', 'act:2': 'automatable', 'act:3': 'human-required', 'act:4': 'automatable' }),
    );
    const run = segs.find((s) => s.activityIds.includes('act:1'))!;
    expect(run.activityIds).toEqual(['act:1', 'act:2']);
    expect(run.coverage).toBe(0.5);
  });

  // The rule that keeps the claim honest.
  it('never merges runs of different labels', () => {
    const segs = deriveSegments(
      graph(),
      opps({ 'act:1': 'automatable', 'act:2': 'assistable', 'act:3': 'human-required', 'act:4': 'automatable' }),
    );
    expect(segs).toHaveLength(4);
    expect(new Set(segs.flatMap((s) => s.activityIds)).size).toBe(4);
  });

  it('does not join two runs separated by a differently-labelled step', () => {
    const segs = deriveSegments(
      graph(),
      opps({ 'act:1': 'automatable', 'act:2': 'automatable', 'act:3': 'human-required', 'act:4': 'automatable' }),
    );
    const automatable = segs.filter((s) => s.label === 'automatable');
    expect(automatable).toHaveLength(2);
    expect(automatable.some((s) => s.activityIds.length === 2)).toBe(true);
    expect(automatable.some((s) => s.activityIds.join() === 'act:4')).toBe(true);
  });

  it('reads a run in flow order, not insertion order', () => {
    const g = graph();
    g.activities.reverse();
    const segs = deriveSegments(g, opps({ 'act:1': 'automatable', 'act:2': 'automatable' }));
    expect(segs[0].activityIds).toEqual(['act:1', 'act:2']);
    expect(segs[0].activityNames).toEqual(['Open record', 'Pull history']);
  });

  it('walks through a gateway, and records that a decision sits inside the run', () => {
    const g = graph({
      gateways: [
        { id: 'gw:x', type: 'exclusive', name: 'Correct?', condition: '', laneId: 'lane:a', sourceFacet: 6 },
      ],
      flows: [
        { id: 'f0', from: 'ev:s', to: 'act:1' },
        { id: 'f1', from: 'act:1', to: 'gw:x' },
        { id: 'f2', from: 'gw:x', to: 'act:2' },
        { id: 'f3', from: 'act:2', to: 'ev:e' },
      ],
    });
    const segs = deriveSegments(g, opps({ 'act:1': 'automatable', 'act:2': 'automatable' }));
    expect(segs[0].activityIds).toEqual(['act:1', 'act:2']);
    expect(segs[0].gatewayIds).toEqual(['gw:x']);
  });

  it('flags a run that crosses a lane, because that is a hand-off automation would remove', () => {
    const segs = deriveSegments(
      graph(),
      opps({ 'act:2': 'automatable', 'act:3': 'automatable' }),
    );
    const run = segs.find((s) => s.activityIds.length === 2)!;
    expect(run.crossesLanes).toBe(true);
    expect(run.laneIds.sort()).toEqual(['lane:a', 'lane:b']);
  });

  it('unions the systems and the cited evidence across the run', () => {
    const segs = deriveSegments(
      graph(),
      opps({ 'act:1': 'automatable', 'act:2': 'automatable' }, { 'act:1': [8, 5], 'act:2': [7, 8] }),
    );
    expect(segs[0].systems).toEqual(['Billing', 'CRM']);
    expect(segs[0].evidence).toEqual([5, 7, 8]);
  });

  it('ranks automation-relevant runs first, largest coverage leading', () => {
    const segs = deriveSegments(
      graph(),
      opps({ 'act:1': 'human-required', 'act:2': 'automatable', 'act:3': 'automatable', 'act:4': 'automatable' }),
    );
    expect(segs[0].label).toBe('automatable');
    expect(segs[0].activityIds).toHaveLength(3);
    expect(segs.at(-1)!.label).toBe('human-required');
  });

  it('ignores an activity that was never classified', () => {
    const segs = deriveSegments(graph(), opps({ 'act:1': 'automatable' }));
    expect(segs).toHaveLength(1);
    expect(segs[0].activityIds).toEqual(['act:1']);
    expect(segs[0].coverage).toBe(0.25);
  });

  it('terminates on a rework loop rather than spinning', () => {
    const g = graph();
    g.flows.push({ id: 'loop', from: 'act:4', to: 'act:1', condition: 'rework' });
    const segs = deriveSegments(g, opps({ 'act:1': 'automatable', 'act:4': 'automatable' }));
    expect(segs.flatMap((s) => s.activityIds).sort()).toEqual(['act:1', 'act:4']);
  });

  it('returns nothing when nothing was classified', () => {
    expect(deriveSegments(graph(), opps({}))).toEqual([]);
  });
});

describe('segment signals', () => {
  it('counts by label and reports the shares a verdict has to respect', () => {
    const g = graph();
    const set = opps({
      'act:1': 'automatable',
      'act:2': 'automatable',
      'act:3': 'human-required',
      'act:4': 'unclassified',
    });
    const s = segmentSignals(g, deriveSegments(g, set));
    expect(s).toMatchObject({
      totalActivities: 4,
      automatable: 2,
      humanRequired: 1,
      unclassified: 1,
      segmentCount: 1,
    });
    expect(s.automationShare).toBe(0.5);
    expect(s.unclassifiedShare).toBe(0.25);
    expect(s.largestRunCoverage).toBe(0.5);
  });

  it('reports zero rather than dividing by nothing on an empty graph', () => {
    const g = graph({ activities: [], flows: [] });
    const s = segmentSignals(g, deriveSegments(g, opps({})));
    expect(s.automationShare).toBe(0);
    expect(s.unclassifiedShare).toBe(0);
    expect(s.largestRunCoverage).toBe(0);
  });
});
