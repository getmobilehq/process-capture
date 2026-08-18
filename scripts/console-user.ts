/**
 * Manage console accounts (SDD I-3).
 *
 * Deliberately a CLI rather than a screen. Creating the people who can approve
 * recommendations about someone else's job is an administrative act, not a
 * self-service one, and a console page to make console accounts is a privilege
 * escalation waiting to be found.
 *
 *   npm run console:user -- --credentials "Their Name"    # for the deployed console
 *   npm run console:user -- --list
 *   npm run console:user -- --add joseph@example.com --name "Joseph Agunbiade"
 *   npm run console:user -- --reset joseph@example.com
 *   npm run console:user -- --disable joseph@example.com
 *   npm run console:user -- --enable joseph@example.com
 *
 * A generated password is printed once and never stored in the clear. If it is
 * lost, reset it — there is no way to read it back, which is the point.
 */
import './load-env';
import { closeDb } from '@/lib/db';
import { generatePassword, hashPassword } from '@/lib/auth';
import {
  createConsoleUser,
  findConsoleUserByEmail,
  listConsoleUsers,
  updateConsoleUser,
} from '@/lib/db/queries';

function parseArgs() {
  const args = process.argv.slice(2);
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
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

const uk = (d: Date | null) => (d ? d.toLocaleDateString('en-GB') : 'never');

async function main() {
  const a = parseArgs();

  // Generate a password and its hash HERE, on the operator's machine. The
  // deployed console is managed by a Cloud Run job whose output goes to Cloud
  // Logging for thirty days — so the password must never be sent there. Only the
  // hash travels, and a hash in a job argument is harmless.
  if (typeof a.credentials === 'string' || a.credentials === true) {
    const who = typeof a.credentials === 'string' ? a.credentials : 'the new account';
    const password = generatePassword();
    const hash = hashPassword(password);
    console.log(`Credentials for ${who}:\n`);
    console.log(`  Password: ${password}`);
    console.log('  (give this to them directly — it is not stored anywhere)\n');
    console.log('Then create the account in the deployed console:\n');
    console.log(`  gcloud run jobs execute magpie-console-user --region=europe-west2 --wait \\`);
    console.log(`    --args="--add,THEIR@EMAIL,--name,${who},--hash,${hash}"\n`);
    return;
  }

  if (a.list) {
    const users = await listConsoleUsers();
    if (users.length === 0) {
      console.log('No console accounts yet. Everyone signs in with the shared password.');
      console.log('Add one:  npm run console:user -- --add someone@example.com --name "Their Name"');
      return;
    }
    console.log(`${users.length} console account(s):\n`);
    for (const u of users) {
      const flag = u.status === 'active' ? ' ' : '✗';
      console.log(`  ${flag} ${u.email.padEnd(34)} ${u.name.padEnd(24)} last seen ${uk(u.lastLoginAt)}`);
    }
    return;
  }

  if (typeof a.add === 'string') {
    const email = a.add.trim().toLowerCase();
    const name = typeof a.name === 'string' ? a.name.trim() : '';
    if (!name) {
      console.error('A name is required — it is what appears against every review they make.');
      console.error('  npm run console:user -- --add someone@example.com --name "Their Name"');
      process.exit(2);
    }
    if (await findConsoleUserByEmail(email)) {
      console.error(`${email} already has an account. Use --reset to issue a new password.`);
      process.exit(1);
    }
    const password = generatePassword();
    const user = await createConsoleUser({ email, name, passwordHash: hashPassword(password) });
    console.log(`Created ${user.name} <${user.email}>.\n`);
    console.log(`  Password: ${password}\n`);
    console.log('Give it to them directly and ask them to keep it in a password manager.');
    console.log('It is not stored in the clear and cannot be shown again.');
    return;
  }

  if (typeof a.reset === 'string') {
    const user = await findConsoleUserByEmail(a.reset);
    if (!user) {
      console.error(`No account for ${a.reset}.`);
      process.exit(1);
    }
    const password = generatePassword();
    await updateConsoleUser(user.id, { passwordHash: hashPassword(password) });
    console.log(`New password for ${user.name} <${user.email}>:\n`);
    console.log(`  ${password}\n`);
    return;
  }

  for (const [flag, status] of [['disable', 'disabled'], ['enable', 'active']] as const) {
    if (typeof a[flag] === 'string') {
      const user = await findConsoleUserByEmail(a[flag] as string);
      if (!user) {
        console.error(`No account for ${a[flag]}.`);
        process.exit(1);
      }
      await updateConsoleUser(user.id, { status });
      console.log(`${user.email} is now ${status}.`);
      if (status === 'disabled') {
        console.log('Their past reviews keep their name — the account is switched off, not erased.');
      }
      return;
    }
  }

  console.log('Usage:');
  console.log('  npm run console:user -- --list');
  console.log('  npm run console:user -- --add EMAIL --name "NAME"');
  console.log('  npm run console:user -- --reset EMAIL');
  console.log('  npm run console:user -- --disable EMAIL | --enable EMAIL');
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
