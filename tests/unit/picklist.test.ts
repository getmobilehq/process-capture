import { describe, it, expect } from 'vitest';
import { makeTestDb, makeSessionFixture } from '../helpers/db';
import { applyTool } from '@/lib/engine/engine';
import {
  listEntities,
  picklistOptions,
  recordEntityMention,
  upsertEntity,
} from '@/lib/db/queries';
import {
  PICKLIST_FACETS,
  canonicalKey,
  entityKindFor,
  isPicklistFacet,
} from '@/lib/facets/facets';
import type { ModelToolCall } from '@/lib/engine/model';

function call(name: string, input: unknown): ModelToolCall {
  return { id: 'tool_1', name, input };
}

describe('elicitation modes (R2.1)', () => {
  it('classifies the four closed-set facets as pick-lists', () => {
    expect(PICKLIST_FACETS.map((f) => f.id).sort()).toEqual([2, 3, 4, 8]);
    expect(isPicklistFacet(8)).toBe(true);
    expect(isPicklistFacet(5)).toBe(false); // workflow stays open
    expect(isPicklistFacet(12)).toBe(false); // bottlenecks stay open
  });

  it('gives every pick-list facet an entity kind, and no open facet one', () => {
    expect(entityKindFor(2)).toBe('role');
    expect(entityKindFor(3)).toBe('trigger');
    expect(entityKindFor(4)).toBe('io');
    expect(entityKindFor(8)).toBe('system');
    expect(entityKindFor(5)).toBeUndefined();
  });
});

describe('canonical vocabulary (R2.3)', () => {
  it('folds spelling and punctuation variants onto one key', () => {
    const key = canonicalKey('Remedy/Helix');
    expect(canonicalKey('remedy helix')).toBe(key);
    expect(canonicalKey('  Remedy / Helix  ')).toBe(key);
    expect(canonicalKey('REMEDY-HELIX')).toBe(key);
  });

  it('de-duplicates entities across informants rather than creating near-twins', () => {
    const { db } = makeTestDb();
    const { session } = makeSessionFixture(db);
    const a = upsertEntity(
      { projectId: session.projectId, kind: 'system', name: 'Remedy/Helix' },
      db,
    );
    const b = upsertEntity(
      { projectId: session.projectId, kind: 'system', name: 'remedy helix' },
      db,
    );
    expect(b.id).toBe(a.id);
  });

  it('keeps the same name under different kinds apart', () => {
    const { db } = makeTestDb();
    const { session } = makeSessionFixture(db);
    const sys = upsertEntity({ projectId: session.projectId, kind: 'system', name: 'Xenia' }, db);
    const role = upsertEntity({ projectId: session.projectId, kind: 'role', name: 'Xenia' }, db);
    expect(role.id).not.toBe(sys.id);
  });
});

describe('option-set seeding (R2.2)', () => {
  it('pre-seeds the VMO2 systems taxonomy on every new engagement', () => {
    const { db } = makeTestDb();
    const { session } = makeSessionFixture(db);
    const systems = listEntities(session.projectId, 'system', db).map((e) => e.name);
    for (const expected of ['OmniEngage', 'iComms', 'Xenia', 'Einstein', 'Remedy/Helix']) {
      expect(systems).toContain(expected);
    }
    expect(listEntities(session.projectId, 'system', db).every((e) => e.status === 'confirmed')).toBe(
      true,
    );
  });

  it('marks every option with the source it came from', () => {
    const { db } = makeTestDb();
    const { session } = makeSessionFixture(db);
    const options = picklistOptions(session.id, 8, db);
    expect(options.length).toBeGreaterThan(0);
    expect(options.every((o) => ['taxonomy', 'this_interview', 'prior_interview'].includes(o.source))).toBe(
      true,
    );
  });

  it('creates an entity named by the informant as pending, not confirmed', () => {
    const { db } = makeTestDb();
    const { session } = makeSessionFixture(db);
    const r = applyTool(
      session,
      call('record_entity', { facetId: 8, kind: 'system', name: 'Some Local Tracker' }),
      db,
    );
    expect(r.isError).toBe(false);
    const created = listEntities(session.projectId, 'system', db).find(
      (e) => e.canonicalKey === canonicalKey('Some Local Tracker'),
    );
    expect(created?.status).toBe('pending');
    expect(created?.origin).toBe('interview');
  });

  // The R2 acceptance criterion.
  it('pre-ticks at facet 8 a system the informant already named at facet 4', () => {
    const { db } = makeTestDb();
    const { session } = makeSessionFixture(db);

    const before = picklistOptions(session.id, 8, db);
    expect(before.some((o) => o.selected)).toBe(false);

    // Named while talking about inputs and outputs, well before facet 8 comes up.
    applyTool(session, call('record_entity', { facetId: 4, kind: 'system', name: 'Xenia' }), db);

    const after = picklistOptions(session.id, 8, db);
    const xenia = after.find((o) => o.name === 'Xenia');
    expect(xenia?.selected).toBe(true);
    // It is confirmed at VMO2, so the taxonomy remains the stronger provenance.
    expect(xenia?.source).toBe('taxonomy');
    // Selected options sort to the top so the informant confirms rather than hunts.
    expect(after[0].selected).toBe(true);
  });

  it("surfaces a colleague's entity as prior_interview, never as this informant's", () => {
    const { db } = makeTestDb();
    const { session } = makeSessionFixture(db);
    const other = makeSessionFixture(db, { projectId: session.projectId });

    const entity = upsertEntity(
      { projectId: session.projectId, kind: 'system', name: 'Colleague Tool' },
      db,
    );
    recordEntityMention(
      { sessionId: other.session.id, entityId: entity.id, facetId: 8, source: 'this_interview' },
      db,
    );

    const option = picklistOptions(session.id, 8, db).find((o) => o.name === 'Colleague Tool');
    expect(option?.source).toBe('prior_interview');
    expect(option?.selected).toBe(false);
  });

  it('returns nothing for an open facet — those are never offered as a list', () => {
    const { db } = makeTestDb();
    const { session } = makeSessionFixture(db);
    expect(picklistOptions(session.id, 5, db)).toEqual([]);
    expect(picklistOptions(session.id, 12, db)).toEqual([]);
  });
});
