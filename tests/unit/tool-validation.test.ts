import { describe, it, expect } from 'vitest';
import { makeTestDb, makeSessionFixture } from '../helpers/db';
import { applyTool } from '@/lib/engine/engine';
import { getCoverageState, setCoverage } from '@/lib/db/queries';
import { elementsFor } from '@/lib/facets/facets';
import type { ModelToolCall } from '@/lib/engine/model';

function call(name: string, input: unknown): ModelToolCall {
  return { id: 'tool_1', name, input };
}

describe('server tool validation (FR-3.2, P1) — every illegal call is rejected', () => {
  it('rejects end_interview while facets are still pending or partial', () => {
    const { db } = makeTestDb();
    const { session } = makeSessionFixture(db);
    const r = applyTool(session, call('end_interview', {}), db);
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/not terminal/i);
  });

  it('accepts end_interview only once every facet is terminal', () => {
    const { db } = makeTestDb();
    const { session } = makeSessionFixture(db);
    for (let f = 1; f <= 12; f += 1) setCoverage(session.id, f, 'answered', db);
    const r = applyTool(session, call('end_interview', {}), db);
    expect(r.isError).toBe(false);
    expect(r.ended).toBe(true);
  });

  // Delta v1.1 R1.1: answered and partial are derived from the checklist, so the
  // model can no longer propose either — the meter cannot be authored directly.
  it.each(['partial', 'answered'])('refuses to let the model declare a facet %s', (state) => {
    const { db } = makeTestDb();
    const { session } = makeSessionFixture(db);
    const r = applyTool(session, call('set_coverage', { facetId: 1, state }), db);
    expect(r.isError).toBe(true);
    expect(getCoverageState(session.id, 1, db)!.state).toBe('pending');
  });

  it('rejects an illegal coverage transition (terminal → terminal)', () => {
    const { db } = makeTestDb();
    const { session } = makeSessionFixture(db);
    setCoverage(session.id, 1, 'not_applicable', db); // now terminal
    const r = applyTool(
      session,
      call('set_coverage', { facetId: 1, state: 'unknown_to_informant' }),
      db,
    );
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/illegal transition/i);
  });

  it('rejects a set_element whose element belongs to another facet', () => {
    const { db } = makeTestDb();
    const { session } = makeSessionFixture(db);
    const r = applyTool(
      session,
      call('set_element', {
        facetId: 4,
        elementId: 'triggers.initiating',
        state: 'captured',
        summary: 'x',
      }),
      db,
    );
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/unknown element/i);
  });

  it('rejects a captured element with no summary — the readback would be empty', () => {
    const { db } = makeTestDb();
    const { session } = makeSessionFixture(db);
    const r = applyTool(
      session,
      call('set_element', { facetId: 3, elementId: 'triggers.initiating', state: 'captured' }),
      db,
    );
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/summary/i);
  });

  it('derives the facet meter as elements close — never more than the checklist shows', () => {
    const { db } = makeTestDb();
    const { session } = makeSessionFixture(db);
    const elements = elementsFor(3);

    for (const [i, e] of elements.entries()) {
      const r = applyTool(
        session,
        call('set_element', {
          facetId: 3,
          elementId: e.id,
          state: 'captured',
          summary: 'captured from the informant',
        }),
        db,
      );
      expect(r.isError).toBe(false);
      const expected = i === elements.length - 1 ? 'answered' : 'partial';
      expect(getCoverageState(session.id, 3, db)!.state).toBe(expected);
    }
  });

  it('rejects a record_statement with an out-of-range facetId', () => {
    const { db } = makeTestDb();
    const { session } = makeSessionFixture(db);
    const r = applyTool(session, call('record_statement', { facetId: 13, kind: 'fact', content: 'x' }), db);
    expect(r.isError).toBe(true);
  });

  it('rejects a record_statement with an unknown kind', () => {
    const { db } = makeTestDb();
    const { session } = makeSessionFixture(db);
    const r = applyTool(session, call('record_statement', { facetId: 1, kind: 'nonsense', content: 'x' }), db);
    expect(r.isError).toBe(true);
  });

  it('rejects a raise_finding with a type not permitted in-session (candidate_conflict)', () => {
    const { db } = makeTestDb();
    const { session } = makeSessionFixture(db);
    const r = applyTool(
      session,
      call('raise_finding', { facetId: 1, type: 'candidate_conflict', title: 't' }),
      db,
    );
    expect(r.isError).toBe(true);
  });

  it('rejects an unknown tool name', () => {
    const { db } = makeTestDb();
    const { session } = makeSessionFixture(db);
    const r = applyTool(session, call('delete_everything', {}), db);
    expect(r.isError).toBe(true);
  });

  it('accepts a well-formed record_statement', () => {
    const { db } = makeTestDb();
    const { session } = makeSessionFixture(db);
    const r = applyTool(session, call('record_statement', { facetId: 5, kind: 'step', content: 'Advisor reads the case.' }), db);
    expect(r.isError).toBe(false);
  });
});
