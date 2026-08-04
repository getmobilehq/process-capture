import { describe, it, expect } from 'vitest';
import {
  MANDATORY_CORE_FACETS,
  budgetState,
  facetFollowUpsSpent,
  highestValueCandidate,
  openItemsFromElements,
  rankCandidates,
  selectFollowUps,
} from '@/lib/engine/priority';
import { ALL_ELEMENTS } from '@/lib/facets/facets';
import type { CoverageStateValue, ElementStateValue } from '@/lib/engine/coverage';

const allOutstanding = ALL_ELEMENTS.map((e) => ({
  facetId: e.facetId,
  elementId: e.id,
  state: 'outstanding' as ElementStateValue,
}));

const coverageAll = (state: CoverageStateValue) =>
  Array.from({ length: 12 }, (_, i) => ({ facetId: i + 1, state }));

describe('information-value ordering (R9.2 / R4.2 — one implementation)', () => {
  it('puts a conflicting claim above everything else', async () => {
    const ranked = rankCandidates({
      coverage: coverageAll('pending'),
      elements: allOutstanding,
      conflictingElementIds: ['performance.volume'],
    });
    expect(ranked[0].elementId).toBe('performance.volume');
    expect(ranked[0].tier).toBe('conflicting');
  });

  it('prefers the mandatory-core facets when nothing conflicts', async () => {
    const ranked = rankCandidates({ coverage: coverageAll('pending'), elements: allOutstanding });
    expect(MANDATORY_CORE_FACETS).toContain(ranked[0].facetId);
  });

  it('prefers finishing a nearly-complete facet over starting a fresh one', async () => {
    // Facet 11 needs one more; facet 7 is untouched. Neither is mandatory-core.
    const elements = ALL_ELEMENTS.filter((e) => e.facetId === 7 || e.facetId === 11).map((e) => ({
      facetId: e.facetId,
      elementId: e.id,
      state: (e.facetId === 11 && e.id !== 'performance.target'
        ? 'captured'
        : 'outstanding') as ElementStateValue,
    }));
    const ranked = rankCandidates({ coverage: coverageAll('partial'), elements });
    expect(ranked[0].facetId).toBe(11);
    expect(ranked[0].tier).toBe('nearly_complete');
  });

  it('never re-asks a facet the informant has honestly closed (P3)', async () => {
    const coverage = coverageAll('pending').map((c) =>
      c.facetId === 9 ? { ...c, state: 'unknown_to_informant' as CoverageStateValue } : c,
    );
    const ranked = rankCandidates({ coverage, elements: allOutstanding });
    expect(ranked.some((c) => c.facetId === 9)).toBe(false);
  });

  it('gives every candidate a reason it can cite (R4.2)', async () => {
    const ranked = rankCandidates({ coverage: coverageAll('pending'), elements: allOutstanding });
    expect(ranked.every((c) => c.because.trim().length > 0)).toBe(true);
  });

  it('asks at most two follow-ups a turn — a listener, not a questionnaire (R4.2)', async () => {
    expect(selectFollowUps({ coverage: coverageAll('pending'), elements: allOutstanding })).toHaveLength(2);
  });

  it('returns nothing to ask once every element is closed', async () => {
    const closed = ALL_ELEMENTS.map((e) => ({
      facetId: e.facetId,
      elementId: e.id,
      state: 'captured' as ElementStateValue,
    }));
    expect(highestValueCandidate({ coverage: coverageAll('answered'), elements: closed })).toBeNull();
  });
});

describe('question budget (R9.1)', () => {
  it('reports a felt horizon the informant can be shown', async () => {
    expect(budgetState(14, 25)).toMatchObject({ asked: 14, remaining: 11, exhausted: false });
  });

  it('is exhausted, not negative, past the cap', async () => {
    expect(budgetState(30, 25)).toMatchObject({ remaining: 0, exhausted: true });
  });

  it('applies a soft per-facet follow-up cap', async () => {
    expect(facetFollowUpsSpent({ 5: 3 }, 5, 3)).toBe(true);
    expect(facetFollowUpsSpent({ 5: 2 }, 5, 3)).toBe(false);
    expect(facetFollowUpsSpent({}, 7, 3)).toBe(false);
  });
});

describe('open items from a truncated interview (R9.3)', () => {
  it('names the facet and the element for every gap, as a follow-up seed list', async () => {
    const items = openItemsFromElements(allOutstanding);
    expect(items).toHaveLength(ALL_ELEMENTS.length);
    expect(items[0]).toMatch(/^Facet 1 \(Process identity & context\) — not covered: /);
  });

  it('lists nothing when the checklist is closed', async () => {
    const closed = ALL_ELEMENTS.map((e) => ({
      facetId: e.facetId,
      elementId: e.id,
      state: 'captured' as ElementStateValue,
    }));
    expect(openItemsFromElements(closed)).toEqual([]);
  });
});
