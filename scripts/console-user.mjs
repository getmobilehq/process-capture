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
// This job NEVER generates or prints a password. Everything it writes goes to
// Cloud Logging and persists there for thirty days, readable by anyone holding
// roles/viewer — so a password printed here is a password published, and these
// are the accounts that approve recommendations about people's jobs.
//
// Instead the operator generates the password on their own machine:
//
//   npm run console:user -- --credentials "Their Name"
//
// which prints a password and its bcrypt hash locally, then passes only the hash:
//
//   gcloud run jobs execute magpie-console-user --region=europe-west2 --wait \
//     --args="--add,someone@example.com,--name,Their Name,--hash,$2b$10$..."
//
// The hash is safe to appear in job arguments and logs; the password never
// leaves the operator's terminal.
import postgres from 'postgres';
import bcrypt from 'bcryptjs';
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

const uk = (d) => (d ? new Date(d).toLocaleDateString('en-GB') : 'never');

/** Refuse anything that is not a bcrypt hash, so a password cannot be passed by mistake. */
function requireHash(value) {
  if (typeof value !== 'string' || !/^\$2[aby]\$\d{2}\$/.test(value)) {
    console.error('--hash must be a bcrypt hash, not a password.');
    console.error('Generate one locally:  npm run console:user -- --credentials "Their Name"');
    process.exit(2);
  }
  return value;
}

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
    const hash = requireHash(a.hash);
    const now = new Date();
    await sql`insert into console_users (id, email, name, password_hash, status, created_at, updated_at)
              values (${nanoid()}, ${email}, ${name}, ${hash}, 'active', ${now}, ${now})`;
    console.log(`Created ${name} <${email}>.`);
    console.log('The password was never sent here, so it is not in this log.');
  } else if (typeof a.reset === 'string') {
    const email = a.reset.trim().toLowerCase();
    const hash = requireHash(a.hash);
    const rows = await sql`update console_users
                           set password_hash = ${hash}, updated_at = ${new Date()}
                           where email = ${email} returning name`;
    if (rows.length === 0) {
      console.error(`No account for ${email}.`);
      process.exit(1);
    }
    console.log(`Password reset for ${rows[0].name} <${email}>.`);
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
    console.log('Usage:');
    console.log('  --list');
    console.log('  --add EMAIL --name "NAME" --hash BCRYPT_HASH');
    console.log('  --reset EMAIL --hash BCRYPT_HASH');
    console.log('  --disable EMAIL | --enable EMAIL');
    console.log('');
    console.log('Generate a hash locally:  npm run console:user -- --credentials "Their Name"');
  }
} catch (err) {
  console.error('console-user failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
