import { execSync } from 'node:child_process';
import postgres from 'postgres';

/**
 * Prepare a dedicated, freshly-seeded Postgres schema for the E2E run.
 *
 * Unlike the unit suite, E2E cannot use pglite: pglite is in-process, and the app
 * under test runs in a separate Next server. This needs a real server both can
 * reach — the local container, or whatever `E2E_DATABASE_URL` points at in CI.
 */
export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgres://postgres:magpie@localhost:5434/magpie_e2e';

export default async function globalSetup() {
  // Drop and recreate public, so each run starts from a known-empty database
  // rather than inheriting rows from the last one.
  const sql = postgres(E2E_DATABASE_URL, { max: 1 });
  try {
    // Both schemas: dropping only `public` leaves Drizzle's migrations journal
    // behind in `drizzle`, so the migrator believes 0000 is already applied and
    // skips it — leaving an empty database that reports "migrations applied".
    await sql.unsafe(
      'DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;',
    );
  } finally {
    await sql.end({ timeout: 5 });
  }

  const env = { ...process.env, DATABASE_URL: E2E_DATABASE_URL };
  execSync('npm run db:migrate', { stdio: 'inherit', env });
  execSync('npm run seed', { stdio: 'inherit', env });
}
