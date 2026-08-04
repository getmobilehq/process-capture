import { describe, it, expect } from 'vitest';
import { makeTestDb, makeSessionFixture } from '../helpers/db';
import {
  deleteProcessGraph,
  getProcessGraph,
  saveProcessGraph,
} from '@/lib/db/queries';

const graph = (name: string) => ({ processId: 'p', name, lanes: [], flows: [] });

describe('process graph persistence (DL.38)', () => {
  it('stores a graph and reads it back by session, version and kind', async () => {
    const { db } = await makeTestDb();
    const { session } = await makeSessionFixture(db);
    await saveProcessGraph(
      { sessionId: session.id, specVersion: 1, kind: 'asis', graph: graph('as-is') },
      db,
    );
    const row = await getProcessGraph(session.id, 1, 'asis', db);
    expect((row?.graph as { name: string }).name).toBe('as-is');
  });

  // Two reviewers must see the same diagram; a silent replace would break that,
  // and would orphan any change-set already keyed to the old graph.
  it('does not replace a stored graph — it returns the one already there', async () => {
    const { db } = await makeTestDb();
    const { session } = await makeSessionFixture(db);
    await saveProcessGraph(
      { sessionId: session.id, specVersion: 1, kind: 'asis', graph: graph('first') },
      db,
    );
    const second = await saveProcessGraph(
      { sessionId: session.id, specVersion: 1, kind: 'asis', graph: graph('second') },
      db,
    );
    expect((second.graph as { name: string }).name).toBe('first');
    expect(((await getProcessGraph(session.id, 1, 'asis', db))!.graph as { name: string }).name).toBe(
      'first',
    );
  });

  it('keeps as-is and to-be apart for the same spec version', async () => {
    const { db } = await makeTestDb();
    const { session } = await makeSessionFixture(db);
    await saveProcessGraph({ sessionId: session.id, specVersion: 1, kind: 'asis', graph: graph('a') }, db);
    await saveProcessGraph(
      {
        sessionId: session.id,
        specVersion: 1,
        kind: 'tobe',
        graph: graph('b'),
        changeSet: { changes: [{ target: 'x' }] },
      },
      db,
    );
    expect(((await getProcessGraph(session.id, 1, 'asis', db))!.graph as { name: string }).name).toBe('a');
    expect(((await getProcessGraph(session.id, 1, 'tobe', db))!.graph as { name: string }).name).toBe('b');
  });

  // A new spec is a new graph; the old one stays put as the record of what was
  // reviewed against the old spec.
  it('keys graphs to a spec version rather than overwriting across versions', async () => {
    const { db } = await makeTestDb();
    const { session } = await makeSessionFixture(db);
    await saveProcessGraph({ sessionId: session.id, specVersion: 1, kind: 'asis', graph: graph('v1') }, db);
    await saveProcessGraph({ sessionId: session.id, specVersion: 2, kind: 'asis', graph: graph('v2') }, db);
    expect(((await getProcessGraph(session.id, 1, 'asis', db))!.graph as { name: string }).name).toBe('v1');
    expect(((await getProcessGraph(session.id, 2, 'asis', db))!.graph as { name: string }).name).toBe('v2');
  });

  it('carries the change-set alongside a to-be graph', async () => {
    const { db } = await makeTestDb();
    const { session } = await makeSessionFixture(db);
    await saveProcessGraph(
      {
        sessionId: session.id,
        specVersion: 1,
        kind: 'tobe',
        graph: graph('b'),
        changeSet: { changes: [{ target: 'act:x' }] },
      },
      db,
    );
    const row = (await getProcessGraph(session.id, 1, 'tobe', db))!;
    expect((row.changeSet as { changes: unknown[] }).changes).toHaveLength(1);
  });

  it('leaves no change-set on an as-is graph', async () => {
    const { db } = await makeTestDb();
    const { session } = await makeSessionFixture(db);
    await saveProcessGraph({ sessionId: session.id, specVersion: 1, kind: 'asis', graph: graph('a') }, db);
    expect((await getProcessGraph(session.id, 1, 'asis', db))!.changeSet).toBeNull();
  });

  it('allows an explicit discard so a graph can be regenerated', async () => {
    const { db } = await makeTestDb();
    const { session } = await makeSessionFixture(db);
    await saveProcessGraph({ sessionId: session.id, specVersion: 1, kind: 'asis', graph: graph('old') }, db);
    await deleteProcessGraph(session.id, 1, 'asis', db);
    expect(await getProcessGraph(session.id, 1, 'asis', db)).toBeUndefined();

    await saveProcessGraph({ sessionId: session.id, specVersion: 1, kind: 'asis', graph: graph('new') }, db);
    expect(((await getProcessGraph(session.id, 1, 'asis', db))!.graph as { name: string }).name).toBe('new');
  });

  it('returns nothing for a spec version that has no graph', async () => {
    const { db } = await makeTestDb();
    const { session } = await makeSessionFixture(db);
    expect(await getProcessGraph(session.id, 9, 'asis', db)).toBeUndefined();
  });
});
