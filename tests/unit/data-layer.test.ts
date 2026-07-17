import { describe, it, expect } from 'vitest';
import { makeTestDb, makeSessionFixture } from '../helpers/db';
import {
  addInterviewee,
  createSession,
  getCoverage,
  listLiveStatements,
  listStatements,
  recordStatement,
  setCoverage,
  supersedeStatement,
} from '@/lib/db/queries';
import { IllegalCoverageTransitionError } from '@/lib/engine/coverage';

describe('append-only statements (P2, §5)', () => {
  it('supersede adds a new row and never mutates the original', () => {
    const { db } = makeTestDb();
    const { session } = makeSessionFixture(db);

    const original = recordStatement(
      { sessionId: session.id, facetId: 6, kind: 'rule', content: 'Advisor credits up to £25.' },
      db,
    );

    const correction = supersedeStatement(
      {
        supersedesId: original.id,
        sessionId: session.id,
        facetId: 6,
        kind: 'rule',
        content: 'Advisor credits up to £50.',
      },
      db,
    );

    const all = listStatements(session.id, db);
    expect(all).toHaveLength(2);

    // Original is untouched.
    const originalReread = all.find((s) => s.id === original.id)!;
    expect(originalReread.content).toBe('Advisor credits up to £25.');
    expect(originalReread.supersedesId).toBeNull();

    // Correction points back at the original.
    expect(correction.supersedesId).toBe(original.id);

    // Live set excludes the superseded original.
    const live = listLiveStatements(session.id, db);
    expect(live).toHaveLength(1);
    expect(live[0].id).toBe(correction.id);
  });
});

describe('coverage transition legality via setCoverage (P1, P3)', () => {
  it('seeds 12 pending rows on session creation', () => {
    const { db } = makeTestDb();
    const { session } = makeSessionFixture(db);
    const rows = getCoverage(session.id, db);
    expect(rows).toHaveLength(12);
    expect(rows.every((r) => r.state === 'pending')).toBe(true);
    expect(rows.map((r) => r.facetId)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('applies legal transitions and rejects illegal ones', () => {
    const { db } = makeTestDb();
    const { session } = makeSessionFixture(db);

    // pending → partial → answered is legal
    expect(setCoverage(session.id, 1, 'partial', db).state).toBe('partial');
    expect(setCoverage(session.id, 1, 'answered', db).state).toBe('answered');

    // answered is terminal → any further move is rejected
    expect(() => setCoverage(session.id, 1, 'partial', db)).toThrow(
      IllegalCoverageTransitionError,
    );

    // partial → not_applicable is illegal
    setCoverage(session.id, 2, 'partial', db);
    expect(() => setCoverage(session.id, 2, 'not_applicable', db)).toThrow(
      IllegalCoverageTransitionError,
    );

    // pending → not_applicable is legal
    expect(setCoverage(session.id, 3, 'not_applicable', db).state).toBe('not_applicable');
  });
});

describe('invite token uniqueness (§5)', () => {
  it('generates distinct, ≥24-char tokens per interviewee', () => {
    const { db } = makeTestDb();
    const { project } = makeSessionFixture(db);

    const a = addInterviewee(
      { projectId: project.id, fullName: 'A', email: 'a@example.com', role: 'r' },
      db,
    );
    const b = addInterviewee(
      { projectId: project.id, fullName: 'B', email: 'b@example.com', role: 'r' },
      db,
    );

    expect(a.inviteToken).not.toBe(b.inviteToken);
    expect(a.inviteToken.length).toBeGreaterThanOrEqual(24);
    expect(b.inviteToken.length).toBeGreaterThanOrEqual(24);
  });

  it('rejects a duplicate invite token at the database (unique index)', () => {
    const { db, sqlite } = makeTestDb();
    const { project, interviewee } = makeSessionFixture(db);

    // Force a collision by inserting a raw row reusing an existing token.
    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO interviewees (id, project_id, full_name, email, role, invite_token, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'invited', ?, ?)`,
        )
        .run(
          'dup-id',
          project.id,
          'Dupe',
          'dupe@example.com',
          'r',
          interviewee.inviteToken,
          Date.now(),
          Date.now(),
        ),
    ).toThrow(/UNIQUE/i);
  });
});
