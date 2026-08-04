/**
 * PostgreSQL connection + Drizzle client.
 *
 * One pool per process, reused across requests. The pool is deliberately small:
 * Cloud Run multiplies instances and Cloud SQL caps total connections — a
 * generous per-instance pool is how three containers exhaust the server's limit.
 *
 * FR-3.8 relies on replaying persisted state rather than an in-memory session
 * store, which is what lets the app scale horizontally at all.
 */

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { config } from '@/lib/config';
import * as schema from './schema';

/**
 * Widened to the common Drizzle Postgres type rather than the postgres-js one, so
 * the pglite instance the tests build is structurally assignable. Pinning DB to a
 * single driver would force the suite to run against a real server — the thing
 * pglite exists to avoid.
 */
export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;

let sql: ReturnType<typeof postgres> | null = null;
let db: DB | null = null;

/** Connections per instance. Small on purpose — see the note above. */
const POOL_MAX = Number(process.env.DB_POOL_MAX ?? 5);

export function getSql(url: string = config.databaseUrl) {
  if (sql) return sql;
  sql = postgres(url, {
    max: POOL_MAX,
    // Cloud SQL closes idle connections; reconnect rather than surfacing an error.
    idle_timeout: 30,
    connect_timeout: 10,
    onnotice: () => {},
  });
  return sql;
}

export function getDb(url: string = config.databaseUrl): DB {
  if (db) return db;
  db = drizzle(getSql(url), { schema });
  return db;
}

/** Close the pool. Used by scripts and tests; the server holds it for its life. */
export async function closeDb(): Promise<void> {
  if (sql) await sql.end({ timeout: 5 });
  sql = null;
  db = null;
}

export { schema };
