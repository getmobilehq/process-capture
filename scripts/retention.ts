/**
 * Apply the retention window (SDD issue I-2).
 *
 * Reports by default and deletes only with --apply, because the first time
 * anyone runs this against real interview data they should be able to see
 * exactly what it would take before it takes it.
 *
 * Usage:
 *   npm run retention                 # report only
 *   npm run retention -- --apply      # delete
 *   npm run retention -- --days 90    # override the configured window
 */
import './load-env';
import { closeDb } from '@/lib/db';
import { applyRetention, describeRetention } from '@/lib/retention';
import { config } from '@/lib/config';

function parseArgs() {
  const args = process.argv.slice(2);
  let apply = false;
  let days: number | undefined;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--apply') apply = true;
    else if (args[i] === '--days') days = Number(args[++i]);
  }
  return { apply, days };
}

async function main() {
  const { apply, days } = parseArgs();
  const retentionDays = days ?? config.retentionDays;
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
    console.error(`RETENTION_DAYS must be a positive number of days, not "${retentionDays}".`);
    process.exit(2);
  }

  const result = await applyRetention({ retentionDays, dryRun: !apply });
  console.log(describeRetention(result));

  for (const s of result.sessions) {
    console.log(`  session ${s.id} — last active ${s.expiredOn.toISOString().slice(0, 10)}`);
  }
  for (const i of result.interviewees) {
    console.log(`  interviewee ${i.fullName} — no sessions remain`);
  }

  if (result.applied) {
    const rows = Object.entries(result.deleted)
      .filter(([, n]) => n > 0)
      .map(([t, n]) => `${t}: ${n}`)
      .join(', ');
    console.log(`Rows removed — ${rows || 'none'}.`);
  } else if (result.sessions.length > 0 || result.interviewees.length > 0) {
    console.log('\nNothing was deleted. Re-run with --apply to carry this out.');
  }
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
