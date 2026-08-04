import { describe, it, expect } from 'vitest';
import { validateChangeSet, validateGraph, validateOpportunities } from '@/lib/graph/validate';
import type { ProcessGraph } from '@/lib/graph/schema';

/** A minimal but legal graph: start → activity → gateway → two ends. */
function graph(overrides: Partial<ProcessGraph> = {}): ProcessGraph {
  return {
    processId: 'fault-management',
    name: 'Fault management',
    specRef: 'spec:v1',
    generatedAt: '2026-08-01T00:00:00.000Z',
    lanes: [{ id: 'lane:agent', name: 'Contact centre agent', sourceFacet: 2 }],
    events: [
      { id: 'ev:start', type: 'start', name: 'Customer reports a fault', laneId: 'lane:agent', sourceFacet: 3 },
      { id: 'ev:end-fixed', type: 'end', name: 'Fault resolved', laneId: 'lane:agent', sourceFacet: 1 },
      { id: 'ev:end-closed', type: 'end', name: 'Work order closed', laneId: 'lane:agent', sourceFacet: 1 },
    ],
    activities: [
      { id: 'act:diagnose', name: 'Run diagnostics', laneId: 'lane:agent', systems: ['ent:einstein'], sourceFacet: 5 },
    ],
    gateways: [
      { id: 'gw:nba', type: 'exclusive', name: 'Next best action', condition: '', laneId: 'lane:agent', sourceFacet: 6 },
    ],
    flows: [
      { id: 'f1', from: 'ev:start', to: 'act:diagnose' },
      { id: 'f2', from: 'act:diagnose', to: 'gw:nba' },
      { id: 'f3', from: 'gw:nba', to: 'ev:end-fixed', condition: 'remote fix' },
      { id: 'f4', from: 'gw:nba', to: 'ev:end-closed', condition: 'engineer visit' },
    ],
    annotations: [
      {
        id: 'ann:outage-misidentification',
        targetId: 'act:diagnose',
        kind: 'bottleneck',
        text: 'External outages are misread as single faults, sending a truck for nothing.',
        evidence: { facet: 12 },
      },
    ],
    ...overrides,
  };
}

describe('process graph validation (R5.1)', () => {
  it('accepts a well-formed graph', async () => {
    expect(validateGraph(graph())).toEqual({ ok: true, errors: [] });
  });

  it('requires exactly one start event', async () => {
    const two = graph();
    two.events.push({ ...two.events[0], id: 'ev:start2' });
    two.flows.push({ id: 'f5', from: 'ev:start2', to: 'act:diagnose' });
    expect(validateGraph(two).errors.join(' ')).toMatch(/exactly one start event, found 2/);

    const none = graph({ events: graph().events.filter((e) => e.type !== 'start') });
    expect(validateGraph(none).errors.join(' ')).toMatch(/exactly one start event, found 0/);
  });

  it('requires at least one end event', async () => {
    const g = graph({ events: graph().events.filter((e) => e.type !== 'end') });
    expect(validateGraph(g).errors.join(' ')).toMatch(/at least one end event/);
  });

  it('rejects a flow that references a node which does not exist', async () => {
    const g = graph();
    g.flows.push({ id: 'f9', from: 'act:diagnose', to: 'act:ghost' });
    expect(validateGraph(g).errors.join(' ')).toMatch(/unknown node "act:ghost"/);
  });

  it('rejects a gateway that does not actually fork', async () => {
    const g = graph();
    g.flows = g.flows.filter((f) => f.id !== 'f4');
    expect(validateGraph(g).errors.join(' ')).toMatch(/Gateway gw:nba has 1 outgoing flow/);
  });

  it('rejects an orphan node', async () => {
    const g = graph();
    g.activities.push({ id: 'act:orphan', name: 'Nobody linked me', laneId: 'lane:agent', systems: [], sourceFacet: 5 });
    expect(validateGraph(g).errors.join(' ')).toMatch(/act:orphan is an orphan/);
  });

  it('rejects a node in a lane that does not exist', async () => {
    const g = graph();
    g.activities[0].laneId = 'lane:ghost';
    expect(validateGraph(g).errors.join(' ')).toMatch(/unknown lane "lane:ghost"/);
  });

  // The lineage rule: no facet, no diagram element.
  it('rejects any element with no facet lineage', async () => {
    const g = graph() as unknown as Record<string, unknown>;
    const acts = (g.activities as Record<string, unknown>[])[0];
    delete acts.sourceFacet;
    const r = validateGraph(g);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/sourceFacet/);
  });

  it('rejects a boundary event floating free of an activity', async () => {
    const g = graph();
    g.events.push({ id: 'ev:not-home', type: 'boundary', name: 'Customer not home', laneId: 'lane:agent', sourceFacet: 10 });
    g.flows.push({ id: 'f6', from: 'ev:not-home', to: 'ev:end-closed' });
    expect(validateGraph(g).errors.join(' ')).toMatch(/not attached to an activity/);
  });

  it('rejects an annotation pinned to a node that is not there', async () => {
    const g = graph();
    g.annotations[0].targetId = 'act:ghost';
    expect(validateGraph(g).errors.join(' ')).toMatch(/targets unknown node/);
  });

  // R5.7 — a corrupted spec must fail loudly, never render a plausible diagram.
  it('fails loudly on a planted fault rather than producing a silent bad graph', async () => {
    const corrupted = graph();
    corrupted.flows = [];
    const r = validateGraph(corrupted);
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThan(1);
  });
});

describe('change sets (R5.4)', () => {
  const base = graph();

  it('accepts a change that resolves a real bottleneck', async () => {
    const cs = {
      baseGraph: 'fault-management-as-is',
      provenance: 'proposed',
      verified: false,
      changes: [
        {
          op: 'add',
          target: 'activity:automated-outage-gate',
          description: 'Insert automated outage verification before dispatch.',
          resolvesAnnotationId: ['ann:outage-misidentification'],
          rationale: 'Facet 12: outage misidentification is a principal cause of wasted truck.',
        },
      ],
    };
    expect(validateChangeSet(cs, base)).toEqual({ ok: true, errors: [] });
  });

  it('rejects a change that resolves nothing — a to-be is not a wishlist', async () => {
    const cs = {
      baseGraph: 'x',
      provenance: 'proposed',
      verified: false,
      changes: [
        { op: 'add', target: 'activity:nice-idea', description: 'Add a dashboard.', resolvesAnnotationId: [], rationale: 'Would be nice.' },
      ],
    };
    const r = validateChangeSet(cs, base);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/resolvesAnnotationId/);
  });

  it('rejects a change that resolves an annotation which does not exist', async () => {
    const cs = {
      baseGraph: 'x',
      provenance: 'proposed',
      verified: false,
      changes: [
        { op: 'modify', target: 'act:diagnose', description: 'Change it.', resolvesAnnotationId: ['ann:imaginary'], rationale: 'Because.' },
      ],
    };
    expect(validateChangeSet(cs, base).errors.join(' ')).toMatch(/unknown annotation "ann:imaginary"/);
  });

  it('cannot be marked verified by construction — that is a human act (R5.4 gate)', async () => {
    const cs = { baseGraph: 'x', provenance: 'proposed', changes: [] };
    const r = validateChangeSet(cs, base);
    expect(r.ok).toBe(true); // verified defaults to false
  });
});

describe('opportunity overlay (R5.5)', () => {
  const base = graph();

  it('accepts a classification with cited evidence', async () => {
    const set = {
      graphRef: 'fault-management-as-is',
      provenance: 'proposed',
      verified: false,
      classifications: [
        { activityId: 'act:diagnose', label: 'automatable', evidence: [8, 9], rationale: 'Einstein already performs this check.' },
      ],
    };
    expect(validateOpportunities(set, base)).toEqual({ ok: true, errors: [] });
  });

  it('refuses a confident label with no evidence behind it', async () => {
    const set = {
      graphRef: 'x',
      provenance: 'proposed',
      verified: false,
      classifications: [
        { activityId: 'act:diagnose', label: 'automatable', evidence: [], rationale: 'Feels automatable.' },
      ],
    };
    expect(validateOpportunities(set, base).errors.join(' ')).toMatch(/label it unclassified/);
  });

  it('allows unclassified with no evidence, provided it explains itself', async () => {
    const set = {
      graphRef: 'x',
      provenance: 'proposed',
      verified: false,
      classifications: [
        { activityId: 'act:diagnose', label: 'unclassified', evidence: [], rationale: 'The interview did not establish which system holds this step.' },
      ],
    };
    expect(validateOpportunities(set, base).ok).toBe(true);
  });
});
