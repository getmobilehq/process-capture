/**
 * Isolated test database: an in-process Postgres (pglite) with migrations applied.
 *
 * pglite rather than a container, deliberately. The suite is the safety net for
 * the whole SQLite→Postgres refactor, and a suite that needs `docker run` before
 * it will pass is a suite people quietly stop running. This keeps `npm test` a
 * single command with no external dependency, while being *actual* Postgres — the
 * same engine compiled to WASM — so jsonb, timestamptz and transaction semantics
 * behave as they will in Cloud SQL rather than approximately.
 *
 * Query functions accept an explicit `db`, so tests never touch the process
 * singleton or a real database.
 */
import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from '@/lib/db/schema';
import * as q from '@/lib/db/queries';

export type TestDb = PgliteDatabase<typeof schema>;

export interface TestDbHandle {
  db: TestDb;
  client: PGlite;
  /** Close the instance. Optional — each is in-memory and dies with the process. */
  close: () => Promise<void>;
}

export async function makeTestDb(): Promise<TestDbHandle> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: './drizzle' });
  return { db, client, close: () => client.close() };
}

/**
 * Convenience: a seeded project + one interviewee + an open session. Pass an
 * existing `projectId` to put a second informant in the same engagement, which is
 * what cross-interview behaviour (R2.2) needs to be tested against.
 */
export async function makeSessionFixture(db: TestDb, opts: { projectId?: string } = {}) {
  const project = opts.projectId
    ? (await q.getProject(opts.projectId, db))!
    : await q.createProject({ name: 'Test campaign', department: 'Ops' }, db);
  const interviewee = await q.addInterviewee(
    { projectId: project.id, fullName: 'Test User', email: 'test@example.com', role: 'Advisor' },
    db,
  );
  const session = await q.createSession(
    { intervieweeId: interviewee.id, projectId: project.id, processName: 'Test process' },
    db,
  );
  return { project, interviewee, session };
}
