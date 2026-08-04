/**
 * Apply pending Drizzle migrations to the configured database.
 * Run via `npm run db:migrate` (part of `npm run setup`).
 */
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { getDb } from '@/lib/db';
import { config } from '@/lib/config';

async function main() {
  const db = getDb();
  await migrate(db as Parameters<typeof migrate>[0], { migrationsFolder: './drizzle' });
  console.log(`Migrations applied to ${config.databaseUrl}`);
}

main();
