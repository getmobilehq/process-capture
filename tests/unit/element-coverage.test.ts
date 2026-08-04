import { describe, it, expect } from 'vitest';
import {
  deriveFacetState,
  facetMeter,
  isElementClosed,
  type ElementSnapshot,
  type ElementStateValue,
} from '@/lib/engine/coverage';
import { FACETS, ALL_ELEMENTS, elementBelongsToFacet, getElement } from '@/lib/facets/facets';

const els = (...states: ElementStateValue[]): ElementSnapshot[] =>
  states.map((state, i) => ({ elementId: `e${i}`, state }));

describe('facet checklists (R1.1)', () => {
  it('gives every facet at least three elements', async () => {
    for (const f of FACETS) {
      expect(f.elements.length, `facet ${f.id} ${f.name}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('keeps element ids globally unique and facet-bound', async () => {
    const ids = ALL_ELEMENTS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(elementBelongsToFacet('triggers.initiating', 3)).toBe(true);
    expect(elementBelongsToFacet('triggers.initiating', 4)).toBe(false);
    expect(elementBelongsToFacet('no.such.element', 3)).toBe(false);
    expect(getElement('no.such.element')).toBeUndefined();
  });

  it('labels elements in plain language — no facet jargon leaks to the rail', async () => {
    for (const e of ALL_ELEMENTS) {
      expect(e.label).not.toMatch(/facet|coverage|provenance|elicit/i);
      expect(e.label.length).toBeLessThan(50);
    }
  });
});

describe('meter derived from the checklist (R1.1)', () => {
  it('is pending while every element is outstanding', async () => {
    expect(deriveFacetState(els('outstanding', 'outstanding'))).toBe('pending');
  });

  it('is partial once some but not all elements are closed', async () => {
    expect(deriveFacetState(els('captured', 'outstanding', 'outstanding'))).toBe('partial');
    expect(deriveFacetState(els('not_applicable', 'outstanding'))).toBe('partial');
  });

  it('is answered only when every element is closed', async () => {
    expect(deriveFacetState(els('captured', 'captured'))).toBe('answered');
    expect(deriveFacetState(els('captured', 'not_applicable'))).toBe('answered');
    expect(deriveFacetState(els('captured', 'captured', 'outstanding'))).toBe('partial');
  });

  it('is not_applicable only when the whole checklist is ruled out', async () => {
    expect(deriveFacetState(els('not_applicable', 'not_applicable'))).toBe('not_applicable');
    expect(deriveFacetState(els('not_applicable', 'captured'))).toBe('answered');
  });

  it('lets an honest unknown close a facet with elements still outstanding (P3)', async () => {
    const state = deriveFacetState(els('outstanding', 'outstanding'), {
      unknownToInformant: true,
    });
    expect(state).toBe('unknown_to_informant');
  });

  it('reports counts, not a bare percentage', async () => {
    const meter = facetMeter(3, els('captured', 'not_applicable', 'outstanding', 'outstanding'));
    expect(meter).toMatchObject({
      facetId: 3,
      state: 'partial',
      captured: 1,
      notApplicable: 1,
      outstanding: 2,
      total: 4,
    });
  });

  it('treats captured and not_applicable as closed, outstanding as open', async () => {
    expect(isElementClosed('captured')).toBe(true);
    expect(isElementClosed('not_applicable')).toBe(true);
    expect(isElementClosed('outstanding')).toBe(false);
  });

  it('cannot report answered while anything is outstanding — the meter cannot overclaim', async () => {
    for (const f of FACETS) {
      const oneShort = f.elements.map((e, i) => ({
        elementId: e.id,
        state: (i === 0 ? 'outstanding' : 'captured') as ElementStateValue,
      }));
      expect(deriveFacetState(oneShort), `facet ${f.id}`).toBe('partial');
    }
  });
});
