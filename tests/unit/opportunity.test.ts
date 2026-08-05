import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const create = vi.fn();
vi.mock('@/lib/engine/model', () => ({ getClient: () => ({ messages: { create } }) }));

import {
  classifyOpportunities,
  summariseOpportunities,
  OpportunityGenerationError,
} from '@/lib/graph/opportunity';
import type { ProcessGraph } from '@/lib/graph/schema';

function graph(): ProcessGraph {
  return {
    processId: 'p', name: 'P', specRef: 's', generatedAt: 'n',
    lanes: [{ id: 'lane:a', name: 'Agent', sourceFacet: 2 }],
    events: [
      { id: 'ev:s', type: 'start', name: 'Start', laneId: 'lane:a', sourceFacet: 3 },
      { id: 'ev:e', type: 'end', name: 'End', laneId: 'lane:a', sourceFacet: 1 },
      { id: 'ev:e2', type: 'end', name: 'Other', laneId: 'lane:a', sourceFacet: 1 },
    ],
    activities: [
      { id: 'act:copy', name: 'Copy values into the form', laneId: 'lane:a', systems: [], sourceFacet: 5 },
      { id: 'act:approve', name: 'Approve the credit', laneId: 'lane:a', systems: [], sourceFacet: 6 },
    ],
    gateways: [{ id: 'gw:x', type: 'exclusive', name: 'X', condition: '', laneId: 'lane:a', sourceFacet: 6 }],
    flows: [
      { id: 'f1', from: 'ev:s', to: 'act:copy' },
      { id: 'f2', from: 'act:copy', to: 'act:approve' },
      { id: 'f3', from: 'act:approve', to: 'gw:x' },
      { id: 'f4', from: 'gw:x', to: 'ev:e' },
      { id: 'f5', from: 'gw:x', to: 'ev:e2' },
    ],
    annotations: [],
  };
}

const reply = (classifications: unknown[]) => ({
  content: [{ type: 'tool_use', id: 't', name: 'emit_opportunities', input: { classifications } }],
});

const good = [
  { activityId: 'act:copy', label: 'automatable', evidence: [8, 5], rationale: 'Values are copied by hand between two systems that already hold them.' },
  { activityId: 'act:approve', label: 'human-required', evidence: [6], rationale: 'A manager holds the approval authority above £500.' },
];

describe('opportunity classification (R5.5)', () => {
  beforeEach(() => create.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it('returns a validated set, always proposed and unverified', async () => {
    create.mockResolvedValueOnce(reply(good));
    const set = await classifyOpportunities(graph(), '# spec');
    expect(set.classifications).toHaveLength(2);
    expect(set.provenance).toBe('proposed');
    expect(set.verified).toBe(false);
  });

  // The rule the whole requirement turns on.
  it('rejects a confident label with no cited evidence, and retries', async () => {
    const bare = [{ ...good[0], evidence: [] }, good[1]];
    create.mockResolvedValueOnce(reply(bare)).mockResolvedValueOnce(reply(good));
    const set = await classifyOpportunities(graph(), '# spec');
    expect(set.classifications[0].evidence).toEqual([8, 5]);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('allows unclassified without evidence, because that is the honest case', async () => {
    const honest = [
      { activityId: 'act:copy', label: 'unclassified', evidence: [], rationale: 'The spec does not say whether this system has an API.' },
      good[1],
    ];
    create.mockResolvedValueOnce(reply(honest));
    const set = await classifyOpportunities(graph(), '# spec');
    expect(set.classifications[0].label).toBe('unclassified');
  });

  it('tells the model to downgrade rather than invent a citation', async () => {
    create.mockResolvedValueOnce(reply([{ ...good[0], evidence: [] }])).mockResolvedValueOnce(reply(good));
    await classifyOpportunities(graph(), '# spec');
    const retry = create.mock.calls[1][0].messages.at(-1).content as string;
    expect(retry).toMatch(/Do not invent a facet citation/i);
    expect(retry).toMatch(/honest unclassified is a correct answer/i);
  });

  it('rejects a label aimed at an activity that is not in the graph', async () => {
    create.mockResolvedValue(reply([{ ...good[0], activityId: 'act:ghost' }]));
    await expect(classifyOpportunities(graph(), '# spec')).rejects.toThrow(OpportunityGenerationError);
  });

  it('classifies nothing when the graph has no activities, without calling the model', async () => {
    const g = graph(); g.activities = [];
    const set = await classifyOpportunities(g, '# spec');
    expect(set.classifications).toEqual([]);
    expect(create).not.toHaveBeenCalled();
  });

  it('offers the model the activity list, its lane and any bottleneck on it', async () => {
    const g = graph();
    g.annotations = [{ id: 'ann:1', targetId: 'act:copy', kind: 'bottleneck', text: 'Manual copying', evidence: { facet: 12 } }];
    create.mockResolvedValueOnce(reply(good));
    await classifyOpportunities(g, '# spec');
    const prompt = create.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain('act:copy');
    expect(prompt).toContain('Agent');
    expect(prompt).toContain('Manual copying');
  });

  it('summarises the split, and how much it would not judge', () => {
    const s = summariseOpportunities({
      graphRef: 'p', provenance: 'proposed', verified: false,
      classifications: [
        { activityId: 'a', label: 'automatable', evidence: [8], rationale: 'x' },
        { activityId: 'b', label: 'unclassified', evidence: [], rationale: 'y' },
      ],
    });
    expect(s).toMatchObject({ automatable: 1, unclassified: 1, total: 2 });
    expect(s.unclassifiedShare).toBe(0.5);
  });
});
