/**
 * In-memory test database: a fresh better-sqlite3 connection with migrations
 * applied. Query functions accept an explicit `db` argument, so tests never touch
 * the process singleton or a file on disk.
 */
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '@/lib/db/schema';
import * as q from '@/lib/db/queries';

export type TestDb = BetterSQLite3Database<typeof schema>;

export function makeTestDb(): { db: TestDb; sqlite: Database.Database } {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: './drizzle' });
  return { db, sqlite };
}

/**
 * Convenience: a seeded project + one interviewee + an open session. Pass an
 * existing `projectId` to put a second informant in the same engagement, which is
 * what cross-interview behaviour (R2.2) needs to be tested against.
 */
export function makeSessionFixture(db: TestDb, opts: { projectId?: string } = {}) {
  const project = opts.projectId
    ? q.getProject(opts.projectId, db)!
    : q.createProject({ name: 'Test campaign', department: 'Ops' }, db);
  const interviewee = q.addInterviewee(
    { projectId: project.id, fullName: 'Test User', email: 'test@example.com', role: 'Advisor' },
    db,
  );
  const session = q.createSession(
    { intervieweeId: interviewee.id, projectId: project.id, processName: 'Test process' },
    db,
  );
  return { project, interviewee, session };
}
