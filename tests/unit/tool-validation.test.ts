import { describe, it, expect } from 'vitest';
import { makeTestDb, makeSessionFixture } from '../helpers/db';
import { applyTool } from '@/lib/engine/engine';
import { setCoverage } from '@/lib/db/queries';
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

  it('rejects an illegal coverage transition (terminal → partial)', () => {
    const { db } = makeTestDb();
    const { session } = makeSessionFixture(db);
    setCoverage(session.id, 1, 'answered', db); // now terminal
    const r = applyTool(session, call('set_coverage', { facetId: 1, state: 'partial' }), db);
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/illegal transition/i);
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
