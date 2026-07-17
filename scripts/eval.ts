/**
 * Evaluation harness (BUILD-REQUIREMENTS §9). Runs a simulated informant against
 * the real engine end-to-end and checks assertions A1–A9. The Phase 6 gate is: all
 * personas pass A1–A9 on three consecutive runs. Usage is logged per run (cost
 * guard). Transcripts + results are persisted to tests/eval/runs/<timestamp>/.
 *
 * Usage: npm run eval [-- --persona cooperative --runs 1]
 */
import './load-env';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '@/lib/db/schema';
import {
  addInterviewee,
  createProject,
  createSession,
  getCoverage,
  getLatestSpec,
  listFindingsForSession,
  listLiveStatements,
  listTurns,
  nextTurnSeq,
} from '@/lib/db/queries';
import { completeInterview, openInterview, processUserTurn } from '@/lib/engine/engine';
import { validateSpec } from '@/lib/spec/validate';
import { informantReply } from '@/lib/eval/informant';
import { runAssertions, type EvalData } from '@/lib/eval/assertions';
import { resetUsage, snapshotUsage } from '@/lib/usage';
import { config } from '@/lib/config';
import type { Persona } from '@/lib/eval/types';

const PERSONA_DIR = './tests/eval/personas';

function parseArgs() {
  const args = process.argv.slice(2);
  let runs = 3;
  let persona: string | null = null;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--runs') runs = Number(args[++i]);
    else if (args[i] === '--persona') persona = args[++i];
  }
  return { runs, persona };
}

function loadPersonas(filter: string | null): Persona[] {
  return readdirSync(PERSONA_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(PERSONA_DIR, f), 'utf8')) as Persona)
    .filter((p) => !filter || p.id === filter);
}

function makeDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: './drizzle' });
  return db;
}

async function runOnce(persona: Persona, runIndex: number, runDir: string) {
  resetUsage();
  const db = makeDb();

  const project = createProject(
    { name: `Eval ${persona.id}`, department: 'Eval', targetProcesses: [persona.processName] },
    db,
  );
  const interviewee = addInterviewee(
    { projectId: project.id, fullName: 'Eval Informant', email: 'eval-informant@example.com', role: persona.role },
    db,
  );
  const session = createSession(
    { intervieweeId: interviewee.id, projectId: project.id, processName: persona.processName },
    db,
  );

  await openInterview(session.id, db);

  const hardCap = persona.turnLimit + 20;
  for (let i = 0; i < hardCap; i += 1) {
    const lastAgent = [...listTurns(session.id, db)].reverse().find((t) => t.speaker === 'agent');
    if (!lastAgent) break;
    const answer = await informantReply(persona, lastAgent.content);
    const seq = nextTurnSeq(session.id, db);
    const res = await processUserTurn(session.id, { seq, content: answer }, db, { maxTurns: hardCap });
    if (res.review) break;
  }

  try {
    await completeInterview(session.id, db);
  } catch {
    // Spec generation/validation failed — A8 will record it.
  }

  const spec = getLatestSpec(session.id, db);
  const turns = listTurns(session.id, db).map((t) => ({ seq: t.seq, speaker: t.speaker, content: t.content }));
  const data: EvalData = {
    turns,
    statements: listLiveStatements(session.id, db).map((s) => ({ facetId: s.facetId, content: s.content, kind: s.kind })),
    coverage: getCoverage(session.id, db).map((c) => ({ facetId: c.facetId, state: c.state })),
    findings: listFindingsForSession(session.id, db).map((f) => ({ facetId: f.facetId, type: f.type })),
    spec: { markdown: spec?.markdown ?? '', openItems: spec?.openItems ?? [] },
    specValidation: spec ? validateSpec(spec.markdown) : { ok: false, errors: ['no spec generated'] },
    userTurnCount: turns.filter((t) => t.speaker === 'user').length,
  };

  const assertions = await runAssertions(persona, data);
  const usage = snapshotUsage();
  const allPass = assertions.every((a) => a.pass);

  writeFileSync(
    join(runDir, `${persona.id}-run${runIndex}.json`),
    JSON.stringify({ persona: persona.id, runIndex, allPass, usage, assertions, coverage: data.coverage, findings: data.findings, transcript: turns, spec: data.spec.markdown }, null, 2),
  );

  return { allPass, assertions, usage, userTurnCount: data.userTurnCount };
}

async function main() {
  const { runs, persona } = parseArgs();
  if (config.mockModel) {
    console.error('Refusing to run evals with MOCK_MODEL=1 — the harness must exercise the live model.');
    process.exit(2);
  }
  if (!config.anthropicApiKey) {
    console.error('ANTHROPIC_API_KEY is not set. Add it to .env before running evals.');
    process.exit(2);
  }

  const personas = loadPersonas(persona);
  if (personas.length === 0) {
    console.error(`No personas found${persona ? ` matching "${persona}"` : ''} in ${PERSONA_DIR}.`);
    process.exit(2);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = join('./tests/eval/runs', stamp);
  mkdirSync(runDir, { recursive: true });

  console.log(`\nEval run ${stamp} · model=${config.model} · ${runs} run(s) × ${personas.length} persona(s)\n`);

  let totalInput = 0;
  let totalOutput = 0;
  const personaPasses: Record<string, number> = {};

  for (const p of personas) {
    console.log(`── Persona: ${p.id} (${p.style}, ${p.role}) ──────────────────────────`);
    let consecutive = 0;
    for (let r = 1; r <= runs; r += 1) {
      const { allPass, assertions, usage, userTurnCount } = await runOnce(p, r, runDir);
      totalInput += usage.inputTokens;
      totalOutput += usage.outputTokens;
      consecutive = allPass ? consecutive + 1 : 0;
      const failed = assertions.filter((a) => !a.pass);
      console.log(
        `  run ${r}: ${allPass ? 'PASS' : 'FAIL'} · ${userTurnCount} turns · ${usage.calls} calls · ${usage.inputTokens}in/${usage.outputTokens}out` +
          (failed.length ? `\n         failed: ${failed.map((f) => `${f.id}(${f.detail})`).join('; ')}` : ''),
      );
    }
    personaPasses[p.id] = consecutive;
  }

  const gateMet = personas.every((p) => personaPasses[p.id] >= Math.min(runs, 3) && runs >= 3);
  console.log(`\nTotals: ${totalInput} input + ${totalOutput} output tokens across all runs.`);
  console.log(`Artefacts: ${runDir}`);
  console.log(
    `\nGate (§9): ${gateMet ? 'PASS — all personas passed A1–A9 on 3 consecutive runs.' : 'not yet met at this run count.'}`,
  );
  console.log('Per persona consecutive passes:', personaPasses);

  process.exit(personas.every((p) => personaPasses[p.id] === runs) ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
