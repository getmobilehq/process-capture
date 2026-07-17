// Plain-Node migration entrypoint for the container (no tsx needed at runtime).
// Uses only production dependencies (better-sqlite3 + drizzle-orm).
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const url = process.env.DATABASE_URL || 'file:./data/app.db';
const path = url.replace(/^file:/, '');
const dir = dirname(path);
if (dir && dir !== '.' && !existsSync(dir)) mkdirSync(dir, { recursive: true });

const sqlite = new Database(path);
sqlite.pragma('journal_mode = WAL');
const db = drizzle(sqlite);
migrate(db, { migrationsFolder: './drizzle' });
console.log('Migrations applied to', url);
