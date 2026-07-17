/**
 * SQLite connection (WAL mode) + Drizzle client.
 *
 * A single better-sqlite3 handle is reused across the process. WAL is enabled for
 * crash-consistency and concurrent reads (FR-3.8 relies on replaying persisted
 * state, not an in-memory store).
 */

import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { config, dbFilePath } from '@/lib/config';
import * as schema from './schema';

export type DB = BetterSQLite3Database<typeof schema>;

let sqlite: Database.Database | null = null;
let db: DB | null = null;

export function getSqlite(url: string = config.databaseUrl): Database.Database {
  if (sqlite) return sqlite;
  const path = dbFilePath(url);
  const dir = dirname(path);
  if (dir && dir !== '.' && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  return sqlite;
}

export function getDb(): DB {
  if (db) return db;
  db = drizzle(getSqlite(), { schema });
  return db;
}

export { schema };
