/**
 * Apply pending Drizzle migrations to the configured database.
 * Run via `npm run db:migrate` (part of `npm run setup`).
 */
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { getDb } from '@/lib/db';
import { config } from '@/lib/config';

function main() {
  const db = getDb();
  migrate(db, { migrationsFolder: './drizzle' });
  console.log(`Migrations applied to ${config.databaseUrl}`);
}

main();
