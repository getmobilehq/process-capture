// Plain-Node migration entrypoint for the container (no tsx needed at runtime).
// Uses only production dependencies (postgres + drizzle-orm).
//
// The container runs this before starting the server, so a fresh deployment
// creates its own tables. That is safe because the service is pinned to a single
// instance (DL.57) — two containers migrating concurrently would race, so if
// max-instances is ever raised this must move to a one-shot Cloud Run Job.
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set — refusing to start without a database.');
  process.exit(1);
}

// A single connection: this runs once at boot and must not leave a pool open.
const sql = postgres(url, { max: 1 });

try {
  await migrate(drizzle(sql), { migrationsFolder: './drizzle' });
  console.log('Migrations applied.');
} catch (err) {
  // Fail loudly and refuse to start. A server that boots without its tables
  // serves 500s on every request and reads like an application bug.
  console.error('Migration failed:', err);
  process.exit(1);
} finally {
  await sql.end({ timeout: 5 });
}
