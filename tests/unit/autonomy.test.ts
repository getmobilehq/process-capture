import { describe, it, expect, vi, beforeEach } from 'vitest';

const create = vi.fn();
vi.mock('@/lib/engine/model', () => ({
  getClient: () => ({ messages: { create } }),
  // Analysis calls carry their own longer timeout — see lib/engine/model.ts.
  ANALYSIS_REQUEST: { timeout: 180_000, maxRetries: 1 },
}));

import {
  assessAutonomy,
  summariseAutonomy,
  validateAutonomy,
  AutonomyError,
  LEVEL_META,
  AUTONOMY_LEVELS,
} from '@/lib/graph/autonomy';
import type { ProcessGraph } from '@/lib/graph/schema';

function graph(): ProcessGraph {
  return {
    processId: 'p', name: 'P', specRef: 's', generatedAt: 'n',
    lanes: [
      { id: 'lane:a', name: 'Advisor', sourceFacet: 2 },
      { id: 'lane:m', name: 'Manager', sourceFacet: 2 },
    ],
    events: [
      { id: 'ev:s', type: 'start', name: 'S', laneId: 'lane:a', sourceFacet: 3 },
      { id: 'ev:e', type: 'end', name: 'E', laneId: 'lane:a', sourceFacet: 1 },
    ],
    activities: [
      { id: 'act:copy', name: 'Copy values between systems', laneId: 'lane:a', systems: ['CRM', 'Billing'], sourceFacet: 5 },
      { id: 'act:draft', name: 'Draft the response', laneId: 'lane:a', systems: [], sourceFacet: 5 },
      { id: 'act:approve', name: 'Approve the credit', laneId: 'lane:m', systems: [], sourceFacet: 6 },
    ],
    gateways: [],
    flows: [{ id: 'f1', from: 'ev:s', to: 'act:copy' }],
    annotations: [],
  };
}

const reply = (levels: unknown[]) => ({
  content: [{ type: 'tool_use', id: 't', name: 'emit_levels', input: { levels } }],
});

const good = [
  { activityId: 'act:copy', level: 'L2', evidence: [8], rationale: 'Both systems hold it.', toAdvance: 'Remove the check once error rates are known.' },
  { activityId: 'act:draft', level: 'L1', evidence: [5], rationale: 'The advisor words it.', toAdvance: 'A drafting model trained on past responses.' },
  { activityId: 'act:approve', level: 'L0', evidence: [6], rationale: 'A manager holds the authority.', toAdvance: 'Authority does not delegate to software.' },
];

describe('autonomy levels (R5.9)', () => {
  beforeEach(() => create.mockReset());

  it('returns a validated set, always proposed and unverified', async () => {
    create.mockResolvedValueOnce(reply(good));
    const set = await assessAutonomy(graph(), '# spec');
    expect(set.levels).toHaveLength(3);
    expect(set.provenance).toBe('proposed');
    expect(set.verified).toBe(false);
  });

  // The rule the feature rests on.
  it('rejects a confident level with no cited evidence, and retries', async () => {
    const bare = [{ ...good[0], evidence: [] }, good[1], good[2]];
    create.mockResolvedValueOnce(reply(bare)).mockResolvedValueOnce(reply(good));
    const set = await assessAutonomy(graph(), '# spec');
    expect(set.levels[0].evidence).toEqual([8]);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('allows unassessed with no evidence, because that is the honest case', async () => {
    const honest = [
      { activityId: 'act:copy', level: 'unassessed', evidence: [], rationale: 'The spec does not say whether the billing platform has an API.', toAdvance: 'Ask the systems owner.' },
      good[1], good[2],
    ];
    create.mockResolvedValueOnce(reply(honest));
    const set = await assessAutonomy(graph(), '# spec');
    expect(set.levels[0].level).toBe('unassessed');
  });

  it('requires every activity to be placed, not just the interesting ones', async () => {
    create.mockResolvedValue(reply([good[0]]));
    await expect(assessAutonomy(graph(), '# spec')).rejects.toThrow(AutonomyError);
    const r = validateAutonomy({ levels: [good[0]] }, graph());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/was not assessed/);
  });

  it('rejects a level aimed at a step that is not in the process', async () => {
    const r = validateAutonomy({ levels: [{ ...good[0], activityId: 'act:ghost' }] }, graph());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/not an activity/);
  });

  it('rejects a level outside the scale', async () => {
    const r = validateAutonomy({ levels: [{ ...good[0], level: 'L9' }] }, graph());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/must be one of/);
  });

  it('tells the model to downgrade rather than invent a citation', async () => {
    create.mockResolvedValueOnce(reply([{ ...good[0], evidence: [] }])).mockResolvedValueOnce(reply(good));
    await assessAutonomy(graph(), '# spec');
    const retry = create.mock.calls[1][0].messages.at(-1).content as string;
    expect(retry).toMatch(/Do not invent a facet citation/i);
    expect(retry).toMatch(/do not raise a level to look decisive/i);
  });

  it('explains that L3 differs from L2 by whether anyone checks', async () => {
    create.mockResolvedValueOnce(reply(good));
    await assessAutonomy(graph(), '# spec');
    const system = create.mock.calls[0][0].system as string;
    expect(system).toMatch(/whether anyone checks the result/i);
    expect(system).toMatch(/L0 is a legitimate destination/i);
  });

  it('places nothing, and calls no model, when there are no activities', async () => {
    const g = graph(); g.activities = [];
    const set = await assessAutonomy(g, '# spec');
    expect(set.levels).toEqual([]);
    expect(create).not.toHaveBeenCalled();
  });
});

describe('summarising by lane', () => {
  it('counts by level and by lane, busiest lane first', () => {
    const g = graph();
    const set = { graphRef: 'p', provenance: 'proposed' as const, verified: false as const, levels: good as never };
    const s = summariseAutonomy(g, set);

    expect(s.total).toBe(3);
    expect(s.counts).toMatchObject({ L0: 1, L1: 1, L2: 1, L3: 0 });
    expect(s.systemCanDo).toBe(1);
    expect(s.byLane[0].laneName).toBe('Advisor');
    expect(s.byLane[0].total).toBe(2);
    expect(s.byLane[1].counts.L0).toBe(1);
  });

  it('counts an unplaced activity as unassessed rather than losing it', () => {
    const g = graph();
    const set = { graphRef: 'p', provenance: 'proposed' as const, verified: false as const, levels: [good[0]] as never };
    const s = summariseAutonomy(g, set);
    expect(s.counts.unassessed).toBe(2);
    expect(s.unassessedShare).toBeCloseTo(2 / 3);
  });

  it('reports zero rather than dividing by nothing on an empty process', () => {
    const g = graph(); g.activities = [];
    const s = summariseAutonomy(g, { graphRef: 'p', provenance: 'proposed', verified: false, levels: [] });
    expect(s.unassessedShare).toBe(0);
    expect(s.byLane).toEqual([]);
  });
});

describe('level presentation', () => {
  it('gives every level a colour and a plain-English gloss', () => {
    for (const l of AUTONOMY_LEVELS) {
      expect(LEVEL_META[l].gloss.length).toBeGreaterThan(8);
      expect(LEVEL_META[l].fill).toMatch(/^#[0-9a-f]{6}$/i);
      expect(LEVEL_META[l].border).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
