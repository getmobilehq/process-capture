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

// Say where we are going before we try to go there. A boot that hangs in
// silence is the worst failure mode there is: the platform kills the container
// on a health check and the logs show nothing at all, so the cause looks like
// anything. Credentials are stripped — the host is the useful part.
const target = url.replace(/\/\/[^@]*@/, '//');
console.log(`Connecting to ${target}`);

// A single connection: this runs once at boot and must not leave a pool open.
// The timeouts are explicit so an unreachable database fails in seconds with a
// message, rather than hanging until the platform gives up on the container.
const sql = postgres(url, {
  max: 1,
  connect_timeout: 15,
  idle_timeout: 20,
  onnotice: () => {},
});

try {
  await migrate(drizzle(sql), { migrationsFolder: './drizzle' });
  console.log('Migrations applied.');
} catch (err) {
  // Fail loudly and refuse to start. A server that boots without its tables
  // serves 500s on every request and reads like an application bug.
  console.error(`Migration failed against ${target}`);
  console.error(err instanceof Error ? `${err.name}: ${err.message}` : err);
  // Drizzle wraps the driver error, so the reason we care about is usually a
  // level or two down the cause chain.
  let chain = '';
  for (let e = err; e; e = e.cause) {
    chain += `${e.name ?? ''} ${e.message ?? ''} ${e.code ?? ''} `;
    console.error(`  caused by: ${e.name ?? 'Error'}: ${e.message ?? ''}${e.code ? ` [${e.code}]` : ''}`);
  }
  if (/timeout|ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ETIMEDOUT|CONNECT_TIMEOUT/i.test(chain)) {
    console.error(
      'The database was not reachable. On Cloud Run check that the service has ' +
        'VPC egress onto the network the instance is peered to, and that ' +
        'DATABASE_URL holds the private IP.',
    );
  }
  process.exit(1);
} finally {
  await sql.end({ timeout: 5 });
}
