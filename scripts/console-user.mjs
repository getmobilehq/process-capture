// Plain-Node console account management, for running inside the deployment
// (no tsx at runtime — mirrors scripts/migrate.mjs).
//
// The database has a private address only, so a laptop cannot reach it. This
// runs as a Cloud Run job on the same VPC, which is the only path in that does
// not involve poking a hole in the network for an administrative errand.
//
//   gcloud run jobs execute magpie-console-user --region=europe-west2 \
//     --args="--list"
//   gcloud run jobs execute magpie-console-user --region=europe-west2 \
//     --args="--add,someone@example.com,--name,Their Name"
//
// A generated password is printed to the job log once. Read it, give it to the
// person, and it is never recoverable — which is the point.
import postgres from 'postgres';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { nanoid } from 'nanoid';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const sql = postgres(url, { max: 1, connect_timeout: 15, onnotice: () => {} });

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i += 1) {
    if (!args[i].startsWith('--')) continue;
    const key = args[i].slice(2);
    const next = args[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

const generate = () => randomBytes(18).toString('base64url');
const uk = (d) => (d ? new Date(d).toLocaleDateString('en-GB') : 'never');

try {
  const a = parseArgs();

  if (a.list) {
    const rows = await sql`select email, name, status, last_login_at
                           from console_users order by email`;
    if (rows.length === 0) {
      console.log('No console accounts yet. Everyone signs in with the shared password.');
    } else {
      console.log(`${rows.length} console account(s):`);
      for (const r of rows) {
        const flag = r.status === 'active' ? ' ' : 'x';
        console.log(`  ${flag} ${r.email.padEnd(34)} ${r.name.padEnd(24)} last seen ${uk(r.last_login_at)}`);
      }
    }
  } else if (typeof a.add === 'string') {
    const email = a.add.trim().toLowerCase();
    const name = typeof a.name === 'string' ? a.name.trim() : '';
    if (!name) {
      console.error('A name is required — it is what appears against every review they make.');
      process.exit(2);
    }
    const existing = await sql`select id from console_users where email = ${email}`;
    if (existing.length > 0) {
      console.error(`${email} already has an account. Use --reset to issue a new password.`);
      process.exit(1);
    }
    const password = generate();
    const now = new Date();
    await sql`insert into console_users (id, email, name, password_hash, status, created_at, updated_at)
              values (${nanoid()}, ${email}, ${name}, ${bcrypt.hashSync(password, 10)}, 'active', ${now}, ${now})`;
    console.log(`Created ${name} <${email}>.`);
    console.log(`  Password: ${password}`);
    console.log('Give it to them directly. It is not stored in the clear and cannot be shown again.');
  } else if (typeof a.reset === 'string') {
    const email = a.reset.trim().toLowerCase();
    const password = generate();
    const rows = await sql`update console_users
                           set password_hash = ${bcrypt.hashSync(password, 10)}, updated_at = ${new Date()}
                           where email = ${email} returning name`;
    if (rows.length === 0) {
      console.error(`No account for ${email}.`);
      process.exit(1);
    }
    console.log(`New password for ${rows[0].name} <${email}>:`);
    console.log(`  ${password}`);
  } else if (typeof a.disable === 'string' || typeof a.enable === 'string') {
    const disabling = typeof a.disable === 'string';
    const email = String(disabling ? a.disable : a.enable).trim().toLowerCase();
    const status = disabling ? 'disabled' : 'active';
    const rows = await sql`update console_users set status = ${status}, updated_at = ${new Date()}
                           where email = ${email} returning name`;
    if (rows.length === 0) {
      console.error(`No account for ${email}.`);
      process.exit(1);
    }
    console.log(`${email} is now ${status}.`);
    if (disabling) console.log('Their past reviews keep their name — the account is off, not erased.');
  } else {
    console.log('Usage: --list | --add EMAIL --name "NAME" | --reset EMAIL | --disable EMAIL | --enable EMAIL');
  }
} catch (err) {
  console.error('console-user failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
