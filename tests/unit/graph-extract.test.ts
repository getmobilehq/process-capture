import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const create = vi.fn();
vi.mock('@/lib/engine/model', () => ({ getClient: () => ({ messages: { create } }) }));

import { extractProcessGraph, GraphExtractionError } from '@/lib/graph/extract';

/** A structurally valid proposal, as the model would return it (no provenance). */
function proposal(overrides: Record<string, unknown> = {}) {
  return {
    processId: 'fault-management',
    name: 'Fault management',
    lanes: [{ id: 'lane:agent', name: 'Agent', sourceFacet: 2 }],
    events: [
      { id: 'ev:start', type: 'start', name: 'Fault reported', laneId: 'lane:agent', sourceFacet: 3 },
      { id: 'ev:end', type: 'end', name: 'Closed', laneId: 'lane:agent', sourceFacet: 1 },
      { id: 'ev:end2', type: 'end', name: 'Escalated', laneId: 'lane:agent', sourceFacet: 1 },
    ],
    activities: [
      { id: 'act:diagnose', name: 'Diagnose', laneId: 'lane:agent', systems: [], sourceFacet: 5 },
    ],
    gateways: [
      { id: 'gw:nba', type: 'exclusive', name: 'Next action', condition: '', laneId: 'lane:agent', sourceFacet: 6 },
    ],
    flows: [
      { id: 'f1', from: 'ev:start', to: 'act:diagnose' },
      { id: 'f2', from: 'act:diagnose', to: 'gw:nba' },
      { id: 'f3', from: 'gw:nba', to: 'ev:end' },
      { id: 'f4', from: 'gw:nba', to: 'ev:end2' },
    ],
    ...overrides,
  };
}

const toolReply = (input: unknown) => ({
  content: [{ type: 'tool_use', id: 't1', name: 'emit_process_graph', input }],
});

/** The second pass returns annotations; default to none unless a test supplies them. */
const annotationReply = (annotations: unknown[] = []) => ({
  content: [{ type: 'tool_use', id: 't2', name: 'emit_annotations', input: { annotations } }],
});

describe('spec → graph extraction (R5.1)', () => {
  beforeEach(() => create.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it('returns a validated graph from a well-formed proposal', async () => {
    create.mockResolvedValueOnce(toolReply(proposal())).mockResolvedValueOnce(annotationReply());
    const g = await extractProcessGraph({
      markdown: '# spec',
      specRef: 'spec:abc:v1',
      now: '2026-08-04T00:00:00.000Z',
    });
    expect(g.processId).toBe('fault-management');
    expect(g.activities).toHaveLength(1);
  });

  // P4 — provenance is structural, not something the model asserts.
  it('stamps specRef and generatedAt server-side, overriding anything proposed', async () => {
    create.mockResolvedValueOnce(
      toolReply(proposal({ specRef: 'spec:MADE-UP', generatedAt: '1999-01-01T00:00:00.000Z' })),
    ).mockResolvedValueOnce(annotationReply());
    const g = await extractProcessGraph({
      markdown: '# spec',
      specRef: 'spec:abc:v1',
      now: '2026-08-04T00:00:00.000Z',
    });
    expect(g.specRef).toBe('spec:abc:v1');
    expect(g.generatedAt).toBe('2026-08-04T00:00:00.000Z');
  });

  it('hands validation errors back and accepts a corrected second attempt', async () => {
    // First proposal has a gateway that does not fork.
    const broken = proposal({
      flows: [
        { id: 'f1', from: 'ev:start', to: 'act:diagnose' },
        { id: 'f2', from: 'act:diagnose', to: 'gw:nba' },
        { id: 'f3', from: 'gw:nba', to: 'ev:end' },
      ],
    });
    create
      .mockResolvedValueOnce(toolReply(broken))
      .mockResolvedValueOnce(toolReply(proposal()))
      .mockResolvedValueOnce(annotationReply());

    const g = await extractProcessGraph({ markdown: '# spec', specRef: 's', now: 'n' });
    expect(g.flows).toHaveLength(4);
    // structural attempt 1, structural retry, then the annotation pass.
    expect(create).toHaveBeenCalledTimes(3);

    // The retry must name the actual failure, not just ask again.
    const retry = create.mock.calls[1][0].messages.at(-1).content as string;
    expect(retry).toMatch(/outgoing flow/i);
  });

  it('does not invent structure to satisfy a rule — it tells the model not to', async () => {
    create.mockResolvedValueOnce(toolReply(proposal({ events: [] }))).mockResolvedValueOnce(
      toolReply(proposal({ events: [] })),
    );
    await expect(
      await extractProcessGraph({ markdown: '# spec', specRef: 's', now: 'n' }),
    ).rejects.toThrow(GraphExtractionError);
    const retry = create.mock.calls[1][0].messages.at(-1).content as string;
    expect(retry).toMatch(/Do not invent steps/i);
  });

  // R5.7 — a corrupted spec fails loudly rather than yielding a silent bad graph.
  it('gives up after two attempts and reports why', async () => {
    create.mockResolvedValue(toolReply(proposal({ flows: [] })));
    await expect(
      await extractProcessGraph({ markdown: '# corrupted', specRef: 's', now: 'n' }),
    ).rejects.toMatchObject({
      name: 'GraphExtractionError',
      errors: expect.arrayContaining([expect.stringMatching(/orphan|outgoing flow/i)]),
    });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('fails rather than guessing when the model returns no tool call', async () => {
    create.mockResolvedValue({ content: [{ type: 'text', text: 'here is a diagram' }] });
    await expect(
      await extractProcessGraph({ markdown: '# spec', specRef: 's', now: 'n' }),
    ).rejects.toThrow(GraphExtractionError);
  });

  it('forces the tool rather than hoping for it', async () => {
    create.mockResolvedValueOnce(toolReply(proposal())).mockResolvedValueOnce(annotationReply());
    await extractProcessGraph({ markdown: '# spec', specRef: 's', now: 'n' });
    expect(create.mock.calls[0][0].tool_choice).toEqual({
      type: 'tool',
      name: 'emit_process_graph',
    });
  });

  it('defaults annotations to empty rather than leaving them undefined', async () => {
    create.mockResolvedValueOnce(toolReply(proposal())).mockResolvedValueOnce(annotationReply());
    const g = await extractProcessGraph({ markdown: '# spec', specRef: 's', now: 'n' });
    expect(g.annotations).toEqual([]);
  });

  // Validated against the real fraud-resolution spec: asking one call for both
  // structure and evidence produced valid graphs with zero annotations, against a
  // specification whose facet 12 described four separate bottlenecks.
  it('reads annotations in a second, dedicated pass', async () => {
    const note = {
      id: 'ann:manual-form',
      targetId: 'act:diagnose',
      kind: 'bottleneck',
      text: 'Agents copy values by hand across three platforms.',
      evidence: { facet: 12, quote: 'the most significant bottleneck' },
    };
    create.mockResolvedValueOnce(toolReply(proposal())).mockResolvedValueOnce(annotationReply([note]));

    const g = await extractProcessGraph({ markdown: '# spec', specRef: 's', now: 'n' });
    expect(g.annotations).toHaveLength(1);
    expect(g.annotations[0].evidence.facet).toBe(12);

    // The second call is a separate concern with its own tool.
    expect(create.mock.calls[1][0].tool_choice).toEqual({ type: 'tool', name: 'emit_annotations' });
    expect(create.mock.calls[1][0].system).toMatch(/facet 12/i);
  });

  it('drops an annotation aimed at a node that is not in the graph', async () => {
    const dangling = {
      id: 'ann:ghost',
      targetId: 'act:not-here',
      kind: 'bottleneck',
      text: 'x',
      evidence: { facet: 12 },
    };
    create.mockResolvedValueOnce(toolReply(proposal())).mockResolvedValueOnce(annotationReply([dangling]));
    const g = await extractProcessGraph({ markdown: '# spec', specRef: 's', now: 'n' });
    expect(g.annotations).toEqual([]);
  });

  // The structure is the more valuable artefact — losing it because the evidence
  // pass stumbled would be the wrong trade.
  it('keeps the graph when the annotation pass fails outright', async () => {
    create.mockResolvedValueOnce(toolReply(proposal())).mockRejectedValueOnce(new Error('boom'));
    const g = await extractProcessGraph({ markdown: '# spec', specRef: 's', now: 'n' });
    expect(g.activities).toHaveLength(1);
    expect(g.annotations).toEqual([]);
  });
});
