/**
 * Run a simulated informant through a real interview, against the configured
 * database, for demo and manual-testing data.
 *
 * This is the eval harness's loop pointed at the real app instead of a throwaway
 * pglite: same engine, same simulated informant, same personas — but it enters
 * through `startSession`, the door the tokenised link uses, so what lands in the
 * console is indistinguishable from a session a person actually sat through.
 *
 * It does not assert anything. The eval harness (§9) is the arbiter of quality;
 * this only fills a database so there is something to look at.
 *
 * Usage: npm run demo:interview -- --token <inviteToken> [--persona cooperative]
 *
 * Costs real Anthropic credits — roughly a full interview's worth per run.
 */
import './load-env';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { closeDb, getDb } from '@/lib/db';
import { startSession } from '@/lib/entry';
import {
  getCoverage,
  getIntervieweeByToken,
  getLatestSpec,
  listFindingsForSession,
  listTurns,
  nextTurnSeq,
} from '@/lib/db/queries';
import { completeInterview, openInterview, processUserTurn } from '@/lib/engine/engine';
import { informantReply } from '@/lib/eval/informant';
import { resetUsage, snapshotUsage } from '@/lib/usage';
import { config } from '@/lib/config';
import type { Persona } from '@/lib/eval/types';

function parseArgs() {
  const args = process.argv.slice(2);
  let token: string | null = null;
  let personaId = 'cooperative';
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--token') token = args[++i];
    else if (args[i] === '--persona') personaId = args[++i];
  }
  return { token, personaId };
}

async function main() {
  const { token, personaId } = parseArgs();
  if (!token) {
    console.error('Usage: npm run demo:interview -- --token <inviteToken> [--persona cooperative]');
    process.exit(2);
  }

  const persona = JSON.parse(
    readFileSync(join('./tests/eval/personas', `${personaId}.json`), 'utf8'),
  ) as Persona;

  const db = getDb();

  const interviewee = await getIntervieweeByToken(token, db);
  if (!interviewee) {
    console.error(`No informant holds the token "${token}".`);
    process.exit(1);
  }
  if (interviewee.status === 'complete') {
    console.error(`${interviewee.fullName} has already completed their interview.`);
    process.exit(1);
  }

  // The persona speaks about its own process; say so rather than letting the
  // informant answer questions about a process the campaign named instead.
  console.log(
    `Interviewing ${interviewee.fullName} (${interviewee.role}) about "${persona.processName}" ` +
      `as the "${persona.id}" persona · model=${config.model}\n`,
  );

  resetUsage();
  const session = await startSession({ token, processName: persona.processName }, db);
  await openInterview(session.id, db);

  const hardCap = persona.turnLimit + 20;
  for (let i = 0; i < hardCap; i += 1) {
    const lastAgent = [...(await listTurns(session.id, db))]
      .reverse()
      .find((t) => t.speaker === 'agent');
    if (!lastAgent) break;

    const answer = await informantReply(persona, lastAgent.content);
    console.log(`  Q${i + 1} ${lastAgent.content.replace(/\s+/g, ' ').slice(0, 96)}`);
    console.log(`   →  ${answer.replace(/\s+/g, ' ').slice(0, 96)}`);

    const seq = await nextTurnSeq(session.id, db);
    const res = await processUserTurn(session.id, { seq, content: answer }, db, {
      maxTurns: hardCap,
    });
    if (res.review) break;
  }

  await completeInterview(session.id, db);

  const coverage = await getCoverage(session.id, db);
  const spec = await getLatestSpec(session.id, db);
  const findings = await listFindingsForSession(session.id, db);
  const usage = snapshotUsage();
  const byState = (s: string) => coverage.filter((c) => c.state === s).length;

  console.log(`\nSession ${session.id} complete.`);
  console.log(
    `  coverage — ${byState('answered')} answered, ${byState('unknown_to_informant')} unknown, ` +
      `${byState('not_applicable')} not applicable`,
  );
  console.log(`  ${findings.length} finding(s) · spec ${spec ? `v${spec.version}` : 'not generated'}`);
  console.log(`  tokens — ${usage.inputTokens} in, ${usage.outputTokens} out`);
  console.log(`\n  Console: ${config.baseUrl}/console/sessions/${session.id}`);
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
