import { describe, it, expect } from 'vitest';
import { applyChangeSet, ChangeSetApplicationError } from '@/lib/graph/apply';
import { validateGraph } from '@/lib/graph/validate';
import type { Change, ChangeSet, ProcessGraph } from '@/lib/graph/schema';

function graph(): ProcessGraph {
  return {
    processId: 'fault-management',
    name: 'Fault management',
    specRef: 'spec:v1',
    generatedAt: '2026-08-04T00:00:00.000Z',
    lanes: [{ id: 'lane:agent', name: 'Agent', sourceFacet: 2 }],
    events: [
      { id: 'ev:start', type: 'start', name: 'Fault reported', laneId: 'lane:agent', sourceFacet: 3 },
      { id: 'ev:fixed', type: 'end', name: 'Fixed remotely', laneId: 'lane:agent', sourceFacet: 1 },
      { id: 'ev:closed', type: 'end', name: 'Work order closed', laneId: 'lane:agent', sourceFacet: 1 },
    ],
    activities: [
      { id: 'act:diagnose', name: 'Run diagnostics', laneId: 'lane:agent', systems: [], sourceFacet: 5 },
      { id: 'act:book', name: 'Raise order and book visit', laneId: 'lane:agent', systems: [], sourceFacet: 5 },
    ],
    gateways: [
      { id: 'gw:nba', type: 'exclusive', name: 'Next best action', condition: '', laneId: 'lane:agent', sourceFacet: 6 },
    ],
    flows: [
      { id: 'f1', from: 'ev:start', to: 'act:diagnose' },
      { id: 'f2', from: 'act:diagnose', to: 'gw:nba' },
      { id: 'f3', from: 'gw:nba', to: 'ev:fixed', condition: 'remote fix' },
      { id: 'f4', from: 'gw:nba', to: 'act:book', condition: 'engineer needed' },
      { id: 'f5', from: 'act:book', to: 'ev:closed' },
    ],
    annotations: [
      {
        id: 'ann:outage',
        targetId: 'act:diagnose',
        kind: 'bottleneck',
        text: 'Outages misread as single faults',
        evidence: { facet: 12 },
      },
      {
        id: 'ann:backlog',
        targetId: 'act:book',
        kind: 'bottleneck',
        text: '25% structural backlog',
        evidence: { facet: 11 },
      },
    ],
  };
}

const set = (changes: Partial<Change>[]): ChangeSet => ({
  baseGraph: 'fault-management',
  provenance: 'proposed',
  verified: false,
  changes: changes.map((c) => ({
    op: 'add',
    target: 'act:new',
    description: 'a change',
    resolvesAnnotationId: ['ann:outage'],
    rationale: 'because',
    ...c,
  })) as Change[],
});

describe('applying a change-set (R5.4)', () => {
  it('never mutates the as-is graph', async () => {
    const base = graph();
    const before = JSON.stringify(base);
    applyChangeSet(
      base,
      set([{ op: 'add', target: 'act:outage-gate', placement: { after: 'act:diagnose', name: 'Verify outage' } }]),
    );
    expect(JSON.stringify(base)).toBe(before);
  });

  it('splices an added node into the flow after its anchor', async () => {
    const { graph: g, changedIds } = applyChangeSet(
      graph(),
      set([{ op: 'add', target: 'act:outage-gate', placement: { after: 'act:diagnose', name: 'Verify outage' } }]),
    );
    expect(g.activities.find((a) => a.id === 'act:outage-gate')?.name).toBe('Verify outage');
    // diagnostics now leads to the gate, and the gate to what diagnostics fed.
    expect(g.flows.some((f) => f.from === 'act:diagnose' && f.to === 'act:outage-gate')).toBe(true);
    expect(g.flows.some((f) => f.from === 'act:outage-gate' && f.to === 'gw:nba')).toBe(true);
    expect(g.flows.some((f) => f.from === 'act:diagnose' && f.to === 'gw:nba')).toBe(false);
    expect(changedIds.has('act:outage-gate')).toBe(true);
    expect(validateGraph(g).ok).toBe(true);
  });

  it('splices before an anchor when asked', async () => {
    const { graph: g } = applyChangeSet(
      graph(),
      set([{ op: 'add', target: 'act:confirm', resolvesAnnotationId: ['ann:backlog'], placement: { before: 'act:book', name: 'Confirm availability' } }]),
    );
    expect(g.flows.some((f) => f.from === 'gw:nba' && f.to === 'act:confirm')).toBe(true);
    expect(g.flows.some((f) => f.from === 'act:confirm' && f.to === 'act:book')).toBe(true);
    expect(validateGraph(g).ok).toBe(true);
  });

  // A proposed step exists because of the evidence, so it inherits its facet.
  it('gives an added node the facet lineage of the bottleneck it resolves', async () => {
    const { graph: g } = applyChangeSet(
      graph(),
      set([{ op: 'add', target: 'act:x', resolvesAnnotationId: ['ann:backlog'], placement: { after: 'act:book' } }]),
    );
    expect(g.activities.find((a) => a.id === 'act:x')?.sourceFacet).toBe(11);
  });

  it('heals the flow when a node is removed, leaving no gap', async () => {
    const { graph: g } = applyChangeSet(graph(), set([{ op: 'remove', target: 'act:book' }]));
    expect(g.activities.some((a) => a.id === 'act:book')).toBe(false);
    expect(g.flows.some((f) => f.from === 'gw:nba' && f.to === 'ev:closed')).toBe(true);
    expect(validateGraph(g).ok).toBe(true);
  });

  it('drops an annotation whose node was removed rather than leaving it dangling', async () => {
    const { graph: g } = applyChangeSet(graph(), set([{ op: 'remove', target: 'act:book' }]));
    expect(g.annotations.some((a) => a.id === 'ann:backlog')).toBe(false);
    expect(g.annotations.some((a) => a.id === 'ann:outage')).toBe(true);
  });

  it('renames on modify and records the node as changed', async () => {
    const { graph: g, changedIds, changeByNode } = applyChangeSet(
      graph(),
      set([{ op: 'modify', target: 'act:book', resolvesAnnotationId: ['ann:backlog'], placement: { name: 'Book by priority' } }]),
    );
    expect(g.activities.find((a) => a.id === 'act:book')?.name).toBe('Book by priority');
    expect(changedIds.has('act:book')).toBe(true);
    // The badge can name the bottleneck this change resolves (Appendix A, pt 4).
    expect(changeByNode.get('act:book')?.resolvesAnnotationId).toEqual(['ann:backlog']);
  });

  it('moves a node on reorder without orphaning it', async () => {
    const { graph: g } = applyChangeSet(
      graph(),
      set([{ op: 'reorder', target: 'act:book', resolvesAnnotationId: ['ann:backlog'], placement: { after: 'ev:start' } }]),
    );
    expect(g.flows.some((f) => f.from === 'ev:start' && f.to === 'act:book')).toBe(true);
    expect(validateGraph(g).ok).toBe(true);
  });

  it('is deterministic — the same set applied twice yields identical graphs', async () => {
    const cs = set([{ op: 'add', target: 'act:gate', placement: { after: 'act:diagnose', name: 'Gate' } }]);
    expect(JSON.stringify(applyChangeSet(graph(), cs).graph)).toBe(
      JSON.stringify(applyChangeSet(graph(), cs).graph),
    );
  });

  // Skipped changes are reported, never silently dropped.
  it('reports an add with no usable placement instead of guessing where it goes', async () => {
    const { skipped, changedIds } = applyChangeSet(graph(), set([{ op: 'add', target: 'act:nowhere' }]));
    expect(skipped).toHaveLength(1);
    expect(skipped[0].reason).toMatch(/placement\.after or placement\.before/);
    expect(changedIds.size).toBe(0);
  });

  it('reports a change targeting a node that is not there', async () => {
    const { skipped } = applyChangeSet(graph(), set([{ op: 'modify', target: 'act:ghost' }]));
    expect(skipped[0].reason).toMatch(/no node "act:ghost"/);
  });

  it('applies an empty change-set as a faithful copy', async () => {
    const { graph: g, changedIds } = applyChangeSet(graph(), set([]));
    expect(changedIds.size).toBe(0);
    expect(g.activities).toHaveLength(2);
    expect(validateGraph(g).ok).toBe(true);
  });

  // A change-set that breaks the process is a failure, not a caveat.
  it('throws rather than returning an incoherent to-be graph', async () => {
    expect(() =>
      applyChangeSet(graph(), set([{ op: 'remove', target: 'ev:start' }])),
    ).toThrow(ChangeSetApplicationError);
  });
});

describe('placement robustness against a real generator (R5.4)', () => {
  it('falls back to the anchor lane when the proposed lane does not exist', async () => {
    // Observed against the fraud-resolution spec: the generator named "lane:agent"
    // from the spec's language, while extraction had chosen different lane ids.
    const { graph: g, skipped } = applyChangeSet(
      graph(),
      set([
        {
          op: 'add',
          target: 'act:check',
          placement: { after: 'act:book', laneId: 'lane:does-not-exist', name: 'Check' },
        },
      ]),
    );
    expect(skipped).toHaveLength(0);
    expect(g.activities.find((a) => a.id === 'act:check')?.laneId).toBe('lane:agent');
    expect(validateGraph(g).ok).toBe(true);
  });
});

describe('collapsing a decision that no longer branches', () => {
  function forked(): ProcessGraph {
    return {
      processId: 'p', name: 'P', specRef: 's', generatedAt: 'n',
      lanes: [{ id: 'lane:a', name: 'Advisor', sourceFacet: 2 }],
      events: [
        { id: 'ev:s', type: 'start', name: 'S', laneId: 'lane:a', sourceFacet: 3 },
        { id: 'ev:e', type: 'end', name: 'E', laneId: 'lane:a', sourceFacet: 1 },
      ],
      activities: [
        { id: 'act:check', name: 'Check the charge', laneId: 'lane:a', systems: [], sourceFacet: 5 },
        { id: 'act:fix', name: 'Raise a credit', laneId: 'lane:a', systems: [], sourceFacet: 5 },
        { id: 'act:close', name: 'Close the case', laneId: 'lane:a', systems: [], sourceFacet: 5 },
      ],
      gateways: [
        { id: 'gw:ok', type: 'exclusive', name: 'Charge correct?', condition: '', laneId: 'lane:a', sourceFacet: 6 },
      ],
      flows: [
        { id: 'f0', from: 'ev:s', to: 'act:check' },
        { id: 'f1', from: 'act:check', to: 'gw:ok' },
        { id: 'f2', from: 'gw:ok', to: 'act:fix', condition: 'incorrect' },
        { id: 'f3', from: 'gw:ok', to: 'act:close', condition: 'correct' },
        { id: 'f4', from: 'act:fix', to: 'act:close' },
        { id: 'f5', from: 'act:close', to: 'ev:e' },
      ],
      annotations: [
        { id: 'ann:1', targetId: 'act:fix', kind: 'bottleneck', text: 'Manual', evidence: { facet: 12 } },
      ],
    };
  }

  // Automate one arm away and the diamond stops being a decision. Leaving it is
  // invalid BPMN and tells a reader a choice is still being made.
  it('removes a gateway left with one exit, and rewires past it', () => {
    const applied = applyChangeSet(forked(), {
      baseGraph: 'p', provenance: 'proposed', verified: false,
      changes: [
        { op: 'remove', target: 'act:fix', description: 'Credits raise themselves', rationale: 'r', resolvesAnnotationId: ['ann:1'] },
      ],
    });

    expect(applied.graph.gateways).toHaveLength(0);
    expect(applied.graph.activities.map((a) => a.id)).not.toContain('act:fix');
    // The path still runs start → check → close → end.
    const to = (from: string) => applied.graph.flows.filter((f) => f.from === from).map((f) => f.to);
    expect(to('act:check')).toEqual(['act:close']);
    expect(to('act:close')).toEqual(['ev:e']);
  });

  it('leaves a gateway that still branches alone', () => {
    const applied = applyChangeSet(forked(), {
      baseGraph: 'p', provenance: 'proposed', verified: false,
      changes: [
        { op: 'modify', target: 'act:fix', description: 'Reworded', rationale: 'r', resolvesAnnotationId: ['ann:1'] },
      ],
    });
    expect(applied.graph.gateways).toHaveLength(1);
    expect(applied.graph.flows.filter((f) => f.from === 'gw:ok')).toHaveLength(2);
  });

  it('creates no self-loop when the gateway led back to its own predecessor', () => {
    const g = forked();
    g.flows = [
      { id: 'f0', from: 'ev:s', to: 'act:check' },
      { id: 'f1', from: 'act:check', to: 'gw:ok' },
      { id: 'f2', from: 'gw:ok', to: 'act:check', condition: 'retry' },
      { id: 'f3', from: 'gw:ok', to: 'act:close', condition: 'done' },
      { id: 'f5', from: 'act:close', to: 'ev:e' },
    ];
    g.activities = g.activities.filter((a) => a.id !== 'act:fix');
    g.annotations = [{ id: 'ann:1', targetId: 'act:close', kind: 'bottleneck', text: 'x', evidence: { facet: 12 } }];

    const applied = applyChangeSet(g, {
      baseGraph: 'p', provenance: 'proposed', verified: false,
      changes: [
        { op: 'remove', target: 'act:close', description: 'gone', rationale: 'r', resolvesAnnotationId: ['ann:1'] },
      ],
    });
    for (const f of applied.graph.flows) expect(f.from).not.toBe(f.to);
  });
});
