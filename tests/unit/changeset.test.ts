import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const create = vi.fn();
vi.mock('@/lib/engine/model', () => ({ getClient: () => ({ messages: { create } }) }));

import { generateChangeSet, ChangeSetGenerationError } from '@/lib/graph/changeset';
import type { ProcessGraph } from '@/lib/graph/schema';

function graph(annotations?: ProcessGraph['annotations']): ProcessGraph {
  return {
    processId: 'fault-management',
    name: 'Fault management',
    specRef: 'spec:v1',
    generatedAt: '2026-08-04T00:00:00.000Z',
    lanes: [{ id: 'lane:agent', name: 'Agent', sourceFacet: 2 }],
    events: [
      { id: 'ev:start', type: 'start', name: 'Fault reported', laneId: 'lane:agent', sourceFacet: 3 },
      { id: 'ev:end', type: 'end', name: 'Closed', laneId: 'lane:agent', sourceFacet: 1 },
      { id: 'ev:end2', type: 'end', name: 'Escalated', laneId: 'lane:agent', sourceFacet: 1 },
    ],
    activities: [
      { id: 'act:book', name: 'Raise order and book visit', laneId: 'lane:agent', systems: [], sourceFacet: 5 },
    ],
    gateways: [
      { id: 'gw:nba', type: 'exclusive', name: 'Next best action', condition: '', laneId: 'lane:agent', sourceFacet: 6 },
    ],
    flows: [
      { id: 'f1', from: 'ev:start', to: 'act:book' },
      { id: 'f2', from: 'act:book', to: 'gw:nba' },
      { id: 'f3', from: 'gw:nba', to: 'ev:end' },
      { id: 'f4', from: 'gw:nba', to: 'ev:end2' },
    ],
    annotations: annotations ?? [
      {
        id: 'ann:backlog-25pct',
        targetId: 'act:book',
        kind: 'bottleneck',
        text: '25% structural backlog; the 24-hour target is met about half the time',
        evidence: { facet: 12, quote: 'it just sits in the queue' },
      },
    ],
  };
}

const reply = (input: unknown) => ({
  content: [{ type: 'tool_use', id: 't1', name: 'emit_change_set', input }],
});

const goodChange = {
  op: 'modify',
  target: 'act:book',
  description: 'Replace the FIFO appointment queue with priority-based scheduling.',
  resolvesAnnotationId: ['ann:backlog-25pct'],
  rationale: 'Facet 12: 25% backlog. Priority queuing improves which faults meet the target; the backlog itself is a supply-demand mismatch this does not fix.',
};

describe('to-be change-set generation (R5.4)', () => {
  beforeEach(() => create.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it('returns a validated set from a well-formed proposal', async () => {
    create.mockResolvedValueOnce(reply({ changes: [goodChange] }));
    const cs = await generateChangeSet(graph());
    expect(cs.changes).toHaveLength(1);
    expect(cs.changes[0].resolvesAnnotationId).toEqual(['ann:backlog-25pct']);
  });

  // The verification gate: approval is a human act, never the generator's.
  it('always emits proposed and unverified, overriding anything the model claims', async () => {
    create.mockResolvedValueOnce(
      reply({ changes: [goodChange], verified: true, provenance: 'stated', baseGraph: 'made-up' }),
    );
    const cs = await generateChangeSet(graph());
    expect(cs.verified).toBe(false);
    expect(cs.provenance).toBe('proposed');
    expect(cs.baseGraph).toBe('fault-management');
  });

  it('rejects a change that resolves nothing, and retries', async () => {
    const wishlist = { ...goodChange, resolvesAnnotationId: [] };
    create
      .mockResolvedValueOnce(reply({ changes: [wishlist] }))
      .mockResolvedValueOnce(reply({ changes: [goodChange] }));

    const cs = await generateChangeSet(graph());
    expect(cs.changes).toHaveLength(1);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('rejects a change attached to an annotation that does not exist', async () => {
    const bogus = { ...goodChange, resolvesAnnotationId: ['ann:imaginary'] };
    create.mockResolvedValue(reply({ changes: [bogus] }));
    await expect(generateChangeSet(graph())).rejects.toMatchObject({
      name: 'ChangeSetGenerationError',
      errors: expect.arrayContaining([expect.stringMatching(/unknown annotation "ann:imaginary"/)]),
    });
  });

  it('tells the model to drop a change rather than attach it to an unrelated bottleneck', async () => {
    create
      .mockResolvedValueOnce(reply({ changes: [{ ...goodChange, resolvesAnnotationId: [] }] }))
      .mockResolvedValueOnce(reply({ changes: [goodChange] }));
    await generateChangeSet(graph());
    const retry = create.mock.calls[1][0].messages.at(-1).content as string;
    expect(retry).toMatch(/do not invent a bottleneck/i);
    expect(retry).toMatch(/Returning fewer changes is a correct answer/i);
  });

  // No evidence, no proposal — the honest outcome, and no model call at all.
  it('returns an empty set without calling the model when nothing is evidenced', async () => {
    const cs = await generateChangeSet(graph([]));
    expect(cs.changes).toEqual([]);
    expect(cs.verified).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it('offers the model only the evidenced bottlenecks to work from', async () => {
    create.mockResolvedValueOnce(reply({ changes: [goodChange] }));
    await generateChangeSet(graph());
    const prompt = create.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain('ann:backlog-25pct');
    expect(prompt).toContain('Raise order and book visit');
    expect(prompt).toMatch(/these, and only these/i);
  });

  it('forces the tool rather than hoping for it', async () => {
    create.mockResolvedValueOnce(reply({ changes: [goodChange] }));
    await generateChangeSet(graph());
    expect(create.mock.calls[0][0].tool_choice).toEqual({ type: 'tool', name: 'emit_change_set' });
  });

  it('fails rather than guessing when the model returns no tool call', async () => {
    create.mockResolvedValue({ content: [{ type: 'text', text: 'I would suggest…' }] });
    await expect(generateChangeSet(graph())).rejects.toThrow(ChangeSetGenerationError);
  });
});
