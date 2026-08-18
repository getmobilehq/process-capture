import { describe, it, expect, vi, beforeEach } from 'vitest';

const create = vi.fn();
vi.mock('@/lib/engine/model', () => ({ getClient: () => ({ messages: { create } }) }));

import {
  assessAutomation,
  permittedVerdicts,
  validateAssessment,
  AssessmentError,
} from '@/lib/graph/assessment';
import { deriveSegments, segmentSignals } from '@/lib/graph/segments';
import type { OpportunitySet, ProcessGraph } from '@/lib/graph/schema';

function graph(n = 4): ProcessGraph {
  return {
    processId: 'p', name: 'P', specRef: 's', generatedAt: 'n',
    lanes: [{ id: 'lane:a', name: 'Advisor', sourceFacet: 2 }],
    events: [
      { id: 'ev:s', type: 'start', name: 'S', laneId: 'lane:a', sourceFacet: 3 },
      { id: 'ev:e', type: 'end', name: 'E', laneId: 'lane:a', sourceFacet: 1 },
    ],
    activities: Array.from({ length: n }, (_, i) => ({
      id: `act:${i + 1}`, name: `Step ${i + 1}`, laneId: 'lane:a', systems: [], sourceFacet: 5,
    })),
    gateways: [],
    flows: [
      { id: 'f0', from: 'ev:s', to: 'act:1' },
      ...Array.from({ length: n - 1 }, (_, i) => ({
        id: `f${i + 1}`, from: `act:${i + 1}`, to: `act:${i + 2}`,
      })),
      { id: 'fe', from: `act:${n}`, to: 'ev:e' },
    ],
    annotations: [],
  };
}

const opps = (labels: Record<string, string>): OpportunitySet => ({
  graphRef: 'p', provenance: 'proposed', verified: false,
  classifications: Object.entries(labels).map(([activityId, label]) => ({
    activityId, label: label as never, evidence: [8], rationale: 'r',
  })),
});

const sig = (labels: Record<string, string>, n = 4) => {
  const g = graph(n);
  const set = opps(labels);
  const segs = deriveSegments(g, set);
  return { g, set, segs, signals: segmentSignals(g, segs) };
};

const reply = (input: unknown) => ({
  content: [{ type: 'tool_use', id: 't', name: 'emit_assessment', input }],
});

describe('permitted verdicts', () => {
  it('forces insufficient-evidence when too much went unjudged', () => {
    const { signals } = sig({ 'act:1': 'automatable', 'act:2': 'unclassified', 'act:3': 'unclassified' });
    expect(permittedVerdicts(signals)).toEqual(['insufficient-evidence']);
  });

  it('allows strong only when the opportunity is both big and contiguous', () => {
    const big = sig({ 'act:1': 'automatable', 'act:2': 'automatable', 'act:3': 'automatable', 'act:4': 'human-required' });
    expect(permittedVerdicts(big.signals)).toContain('strong-candidate');

    // Same share, but scattered — no run reaches 40%.
    const scattered = sig({
      'act:1': 'automatable', 'act:2': 'human-required',
      'act:3': 'automatable', 'act:4': 'human-required',
    });
    expect(permittedVerdicts(scattered.signals)).not.toContain('strong-candidate');
  });

  it('offers only poor when almost nothing is automatable', () => {
    const { signals } = sig({
      'act:1': 'human-required', 'act:2': 'human-required',
      'act:3': 'human-required', 'act:4': 'human-required',
    });
    expect(permittedVerdicts(signals)).toEqual(['insufficient-evidence', 'poor-candidate']);
  });

  it('says insufficient-evidence for an unclassified process', () => {
    const { signals } = sig({});
    expect(permittedVerdicts(signals)).toEqual(['insufficient-evidence']);
  });
});

describe('assessment validation', () => {
  const base = { headline: 'h', reasoning: 'r', segments: [], openQuestions: [] };

  it('refuses a verdict the numbers do not support', () => {
    const { segs, signals } = sig({
      'act:1': 'human-required', 'act:2': 'human-required',
      'act:3': 'human-required', 'act:4': 'automatable',
    });
    const r = validateAssessment({ ...base, verdict: 'strong-candidate' }, segs, signals);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/does not support "strong-candidate"/);
  });

  it('refuses a segment that does not exist', () => {
    const { segs, signals } = sig({ 'act:1': 'automatable', 'act:2': 'automatable' });
    const r = validateAssessment(
      { ...base, verdict: 'partial-candidate', segments: [{ segmentId: 'seg:ghost', why: 'w', precondition: 'p', staysHuman: 's' }] },
      segs, signals,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/does not exist/);
  });

  it('requires open questions when the answer is insufficient-evidence', () => {
    const { segs, signals } = sig({ 'act:1': 'unclassified', 'act:2': 'unclassified' });
    const r = validateAssessment({ ...base, verdict: 'insufficient-evidence' }, segs, signals);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/questions that would close the gap/);
  });
});

describe('assessing a process', () => {
  beforeEach(() => create.mockReset());

  it('returns a validated assessment, always proposed and unverified', async () => {
    const { g, set, segs } = sig({ 'act:1': 'automatable', 'act:2': 'automatable', 'act:3': 'automatable', 'act:4': 'human-required' });
    create.mockResolvedValueOnce(reply({
      verdict: 'strong-candidate', headline: 'Three of four steps are system work.',
      reasoning: 'Facet 8 says the systems already hold the data.',
      segments: [{ segmentId: segs[0].id, why: 'w', precondition: 'p', staysHuman: 's' }],
      openQuestions: [],
    }));
    const a = await assessAutomation(g, set);
    expect(a.verdict).toBe('strong-candidate');
    expect(a.provenance).toBe('proposed');
    expect(a.verified).toBe(false);
    expect(a.derived).toHaveLength(2);
  });

  // The rule the whole feature turns on.
  it('rejects an over-claimed verdict and pushes back, rather than accepting it', async () => {
    const { g, set } = sig({
      'act:1': 'human-required', 'act:2': 'human-required',
      'act:3': 'human-required', 'act:4': 'automatable',
    });
    create
      .mockResolvedValueOnce(reply({ verdict: 'strong-candidate', headline: 'h', reasoning: 'r', segments: [], openQuestions: [] }))
      .mockResolvedValueOnce(reply({ verdict: 'poor-candidate', headline: 'Mostly judgement.', reasoning: 'Facet 6 gives approval authority throughout.', segments: [], openQuestions: [] }));
    const a = await assessAutomation(g, set);
    expect(a.verdict).toBe('poor-candidate');
    expect(create).toHaveBeenCalledTimes(2);
    const retry = create.mock.calls[1][0].messages.at(-1).content as string;
    expect(retry).toMatch(/Do not argue the numbers up/);
  });

  it('never calls the model when nothing was classified', async () => {
    const { g, set } = sig({});
    const a = await assessAutomation(g, set);
    expect(a.verdict).toBe('insufficient-evidence');
    expect(a.openQuestions.length).toBeGreaterThan(0);
    expect(create).not.toHaveBeenCalled();
  });

  it('gives up rather than accept an invalid assessment', async () => {
    const { g, set } = sig({ 'act:1': 'automatable', 'act:2': 'automatable', 'act:3': 'automatable', 'act:4': 'automatable' });
    create.mockResolvedValue(reply({ verdict: 'nonsense', headline: 'h', reasoning: 'r', segments: [], openQuestions: [] }));
    await expect(assessAutomation(g, set)).rejects.toThrow(AssessmentError);
  });

  it('tells the model which verdicts the numbers permit', async () => {
    const { g, set, segs } = sig({ 'act:1': 'automatable', 'act:2': 'human-required', 'act:3': 'human-required', 'act:4': 'human-required' });
    create.mockResolvedValueOnce(reply({
      verdict: 'poor-candidate', headline: 'h', reasoning: 'r',
      segments: [{ segmentId: segs[0].id, why: 'w', precondition: 'p', staysHuman: 's' }],
      openQuestions: [],
    }));
    await assessAutomation(g, set);
    const prompt = create.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toMatch(/Verdicts the numbers permit/);
    expect(prompt).toMatch(/Segments \(fixed/);
    expect(prompt).not.toMatch(/£|cost|saving/i);
  });
});
