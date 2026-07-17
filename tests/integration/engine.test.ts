import { describe, it, expect } from 'vitest';
import { makeTestDb, makeSessionFixture, type TestDb } from '../helpers/db';
import { openInterview, processUserTurn } from '@/lib/engine/engine';
import {
  getCoverage,
  listFindingsForSession,
  listTurns,
  nextTurnSeq,
} from '@/lib/db/queries';
import { countQuestions } from '@/lib/engine/one-question';

/** Drive the mocked engine to completion, returning the final turn result. */
async function runToReview(db: TestDb, sessionId: string, maxTurns = 20) {
  await openInterview(sessionId, db);
  let last;
  for (let i = 0; i < maxTurns; i += 1) {
    const seq = nextTurnSeq(sessionId, db);
    last = await processUserTurn(sessionId, { seq, content: 'Here is my answer.' }, db);
    if (last.review) break;
  }
  return last!;
}

describe('interview engine — mocked golden path (FR-3)', () => {
  it('drives coverage to a terminal state and reaches review with 11 answered + 1 unknown', async () => {
    const { db } = makeTestDb();
    const { session } = makeSessionFixture(db);

    const final = await runToReview(db, session.id);

    expect(final.review).toBe(true);
    expect(final.status).toBe('review');

    const coverage = getCoverage(session.id, db);
    const answered = coverage.filter((c) => c.state === 'answered').length;
    const unknown = coverage.filter((c) => c.state === 'unknown_to_informant').length;
    const pendingOrPartial = coverage.filter((c) => c.state === 'pending' || c.state === 'partial').length;

    expect(answered).toBe(11);
    expect(unknown).toBe(1);
    expect(pendingOrPartial).toBe(0); // no silent gaps (P3)

    // Facet 9 is the informant's genuine unknown.
    expect(coverage.find((c) => c.facetId === 9)!.state).toBe('unknown_to_informant');
  });

  it('opens with a single agent question before any user input', async () => {
    const { db } = makeTestDb();
    const { session } = makeSessionFixture(db);
    await openInterview(session.id, db);
    const turns = listTurns(session.id, db);
    expect(turns).toHaveLength(1);
    expect(turns[0].speaker).toBe('agent');
    expect(turns[0].seq).toBe(1);
  });

  it('raises an unknown_retarget finding for the unknown facet (A2)', async () => {
    const { db } = makeTestDb();
    const { session } = makeSessionFixture(db);
    await runToReview(db, session.id);
    const findings = listFindingsForSession(session.id, db);
    const retarget = findings.find((f) => f.type === 'unknown_retarget' && f.facetId === 9);
    expect(retarget).toBeDefined();
  });

  it('keeps to one question per agent turn (FR-3.3, A5)', async () => {
    const { db } = makeTestDb();
    const { session } = makeSessionFixture(db);
    await runToReview(db, session.id);
    const agentTurns = listTurns(session.id, db).filter((t) => t.speaker === 'agent');
    // Every non-final (non-review) agent turn asks at most one question.
    for (const turn of agentTurns.slice(0, -1)) {
      expect(countQuestions(turn.content)).toBeLessThanOrEqual(1);
    }
  });

  it('is idempotent on a resubmitted user turn (FR-3.9)', async () => {
    const { db } = makeTestDb();
    const { session } = makeSessionFixture(db);
    await openInterview(session.id, db);

    const seq = nextTurnSeq(session.id, db);
    const first = await processUserTurn(session.id, { seq, content: 'My answer.' }, db);
    const turnsAfterFirst = listTurns(session.id, db).length;

    // Resubmit the exact same user turn (network retry).
    const retry = await processUserTurn(session.id, { seq, content: 'My answer.' }, db);
    const turnsAfterRetry = listTurns(session.id, db).length;

    expect(retry.agentTurn.content).toBe(first.agentTurn.content);
    expect(turnsAfterRetry).toBe(turnsAfterFirst); // no duplicate turns
  });
});

describe('interview engine — hard stop (FR-3.7)', () => {
  it('forces review at the turn cap, marking unresolved facets unknown with a flag', async () => {
    const { db } = makeTestDb();
    const { session } = makeSessionFixture(db);
    await openInterview(session.id, db);

    // A tiny cap so the hard stop fires long before the golden path completes.
    let res;
    for (let i = 0; i < 6; i += 1) {
      const seq = nextTurnSeq(session.id, db);
      res = await processUserTurn(session.id, { seq, content: 'answer' }, db, { maxTurns: 2 });
      if (res.review) break;
    }

    expect(res!.review).toBe(true);
    expect(res!.warnings.some((w) => w.includes('hard-stop'))).toBe(true);

    const coverage = getCoverage(session.id, db);
    expect(coverage.filter((c) => c.state === 'pending' || c.state === 'partial')).toHaveLength(0);

    // Truncated facets are marked unknown_to_informant with an informant_flag.
    const flags = listFindingsForSession(session.id, db).filter((f) => f.type === 'informant_flag');
    expect(flags.length).toBeGreaterThan(0);
  });
});
