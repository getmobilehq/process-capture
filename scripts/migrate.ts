/**
 * Apply pending Drizzle migrations to the configured database.
 * Run via `npm run db:migrate` (part of `npm run setup`).
 */
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { config } from '@/lib/config';

/**
 * Builds its own single-connection client rather than reusing getDb(): the
 * migrator needs a postgres-js database specifically, and the app's pool is
 * typed as the driver-agnostic PgDatabase so the pglite test double stays
 * assignable. A dedicated connection also means the pool cannot outlive the
 * script and hold the process open.
 */
async function main() {
  const sql = postgres(config.databaseUrl, { max: 1 });
  try {
    await migrate(drizzle(sql), { migrationsFolder: './drizzle' });
    console.log(`Migrations applied to ${config.databaseUrl}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
