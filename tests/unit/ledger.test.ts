import { describe, it, expect } from 'vitest';
import { makeTestDb, makeSessionFixture } from '../helpers/db';
import { buildLedger, facetHasClaims, ledgerBlock } from '@/lib/engine/ledger';
import { recordStatement, setElement } from '@/lib/db/queries';

/**
 * R4.3 — follow-up generation reads the ledger, not the raw transcript. These
 * tests assert the ledger actually carries what would otherwise be re-asked.
 */
describe('claims ledger (R4.3)', () => {
  it('carries a captured element as a claim against its facet', () => {
    const { db } = makeTestDb();
    const { session } = makeSessionFixture(db);
    setElement(
      {
        sessionId: session.id,
        facetId: 3,
        elementId: 'triggers.initiating',
        state: 'captured',
        summary: 'A customer ringing in about a wrong charge.',
      },
      db,
    );

    const ledger = buildLedger(session.id, db);
    const entry = ledger.find((e) => e.elementId === 'triggers.initiating');
    expect(entry?.claim).toBe('A customer ringing in about a wrong charge.');
    expect(entry?.provenance).toBe('stated');
    expect(entry?.facetName).toBe('Triggers & events');
  });

  it('carries recorded statements with a turn reference', () => {
    const { db } = makeTestDb();
    const { session } = makeSessionFixture(db);
    recordStatement(
      { sessionId: session.id, facetId: 6, kind: 'rule', content: 'Advisors can credit up to £25.' },
      db,
    );
    const entry = buildLedger(session.id, db).find((e) => e.claim.includes('£25'));
    expect(entry?.turnRef).toBeDefined();
    expect(entry?.facetId).toBe(6);
  });

  it('renders a compact block that names each claim and its provenance', () => {
    const { db } = makeTestDb();
    const { session } = makeSessionFixture(db);
    setElement(
      {
        sessionId: session.id,
        facetId: 1,
        elementId: 'identity.purpose',
        state: 'captured',
        summary: 'Putting wrong charges right.',
      },
      db,
    );
    const block = ledgerBlock(buildLedger(session.id, db));
    expect(block).toMatch(/never ask for any of this again/i);
    expect(block).toContain('Putting wrong charges right. [stated]');
  });

  it('is empty for a fresh session, so it never fabricates prior knowledge', () => {
    const { db } = makeTestDb();
    const { session } = makeSessionFixture(db);
    expect(buildLedger(session.id, db)).toEqual([]);
    expect(ledgerBlock([])).toBe('');
  });

  it('does not report a claim for a facet that only has outstanding elements', () => {
    const { db } = makeTestDb();
    const { session } = makeSessionFixture(db);
    setElement(
      {
        sessionId: session.id,
        facetId: 1,
        elementId: 'identity.purpose',
        state: 'captured',
        summary: 'Putting wrong charges right.',
      },
      db,
    );
    const ledger = buildLedger(session.id, db);
    expect(facetHasClaims(ledger, 1)).toBe(true);
    expect(facetHasClaims(ledger, 12)).toBe(false);
  });

  it('excludes a superseded statement — the ledger reflects what they settled on (P2)', () => {
    const { db } = makeTestDb();
    const { session } = makeSessionFixture(db);
    const first = recordStatement(
      { sessionId: session.id, facetId: 11, kind: 'metric', content: 'About twenty a day.' },
      db,
    );
    recordStatement(
      {
        sessionId: session.id,
        facetId: 11,
        kind: 'metric',
        content: 'Sorry — about forty a day.',
        supersedesId: first.id,
      },
      db,
    );
    const claims = buildLedger(session.id, db).map((e) => e.claim);
    expect(claims).toContain('Sorry — about forty a day.');
    expect(claims).not.toContain('About twenty a day.');
  });
});
