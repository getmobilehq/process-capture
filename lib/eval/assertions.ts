/**
 * Eval assertions A1–A9 (BUILD-REQUIREMENTS §9). Hard gates run against a completed
 * simulated interview: session, statements, coverage, findings, and the generated
 * spec. A9 (facet fidelity) uses string containment first, with a model-graded
 * fallback for the items string matching misses.
 */
import Anthropic from '@anthropic-ai/sdk';
import { config } from '@/lib/config';
import { addUsage } from '@/lib/usage';
import { isTerminal, type CoverageStateValue } from '@/lib/engine/coverage';
import { countQuestions } from '@/lib/engine/one-question';
import type { Persona } from './types';

export interface EvalData {
  turns: { seq: number; speaker: string; content: string }[];
  statements: { facetId: number; content: string; kind: string }[];
  coverage: { facetId: number; state: CoverageStateValue }[];
  findings: { facetId: number; type: string }[];
  spec: { markdown: string; openItems: string[] };
  specValidation: { ok: boolean; errors: string[] };
  userTurnCount: number;
}

export interface AssertionResult {
  id: string;
  label: string;
  pass: boolean;
  detail: string;
}

const BANNED_FRAMINGS = [
  'so presumably',
  'i assume',
  'i imagine',
  'i suppose',
  'i take it',
  'the correct process is',
  'the right way is',
  "wouldn't you",
  "isn't it",
  'you probably',
  'surely you',
];

function statementsByFacet(data: EvalData): Map<number, string> {
  const m = new Map<number, string>();
  for (const s of data.statements) {
    m.set(s.facetId, `${m.get(s.facetId) ?? ''} ${s.content}`.toLowerCase());
  }
  return m;
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: config.anthropicApiKey });
  return client;
}

async function judgePresent(concept: string, statements: string): Promise<boolean> {
  if (!statements.trim()) return false;
  const resp = (await getClient()).messages.create({
    model: config.model,
    max_tokens: 8,
    temperature: 0,
    system:
      'You check whether a set of interview statements expresses a given concept. Answer with only "yes" or "no".',
    messages: [
      {
        role: 'user',
        content: `Concept: "${concept}"\n\nStatements:\n${statements}\n\nDo the statements express the concept? Answer yes or no.`,
      },
    ],
  });
  addUsage(resp.usage);
  const text = resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .toLowerCase();
  return text.includes('yes');
}

export async function runAssertions(persona: Persona, data: EvalData): Promise<AssertionResult[]> {
  const results: AssertionResult[] = [];
  const byFacet = statementsByFacet(data);
  const agentTurns = data.turns.filter((t) => t.speaker === 'agent');

  // A1 — all facets terminal (P3).
  const nonTerminal = data.coverage.filter((c) => !isTerminal(c.state));
  results.push({
    id: 'A1',
    label: 'All 12 facets terminal',
    pass: nonTerminal.length === 0 && data.coverage.length === 12,
    detail: nonTerminal.length ? `non-terminal: ${nonTerminal.map((c) => c.facetId).join(',')}` : 'ok',
  });

  // A2 — known-unknown facet lands unknown_to_informant WITH an unknown_retarget finding.
  const kuState = data.coverage.find((c) => c.facetId === persona.knownUnknownFacet)?.state;
  const hasRetarget = data.findings.some(
    (f) => f.type === 'unknown_retarget' && f.facetId === persona.knownUnknownFacet,
  );
  results.push({
    id: 'A2',
    label: 'Known-unknown facet → unknown_to_informant + unknown_retarget finding',
    pass: kuState === 'unknown_to_informant' && hasRetarget,
    detail: `facet ${persona.knownUnknownFacet} state=${kuState}, retarget=${hasRetarget}`,
  });

  // A3 — facet-6 statements capture the numeric thresholds.
  const facet6 = byFacet.get(6) ?? '';
  const missingThresholds = persona.facet6Thresholds.filter((t) => !facet6.includes(t.toLowerCase()));
  results.push({
    id: 'A3',
    label: 'Facet 6 captures numeric thresholds',
    pass: missingThresholds.length === 0,
    detail: missingThresholds.length ? `missing: ${missingThresholds.join(',')}` : 'ok',
  });

  // A4 — facet-12 has at least one bottleneck statement.
  const facet12 = byFacet.get(12) ?? '';
  const bottleneckHit = persona.facet12Bottleneck.some((k) => facet12.includes(k.toLowerCase()));
  results.push({
    id: 'A4',
    label: 'Facet 12 has a bottleneck statement',
    pass: bottleneckHit,
    detail: bottleneckHit ? 'ok' : `none of: ${persona.facet12Bottleneck.join(',')}`,
  });

  // A5 — one question per agent turn ≥ 95% (closing/review turn excepted).
  const oneQ = agentTurns.filter((t) => countQuestions(t.content) <= 1).length;
  const ratio = agentTurns.length ? oneQ / agentTurns.length : 1;
  results.push({
    id: 'A5',
    label: 'One question per agent turn (≥95%)',
    pass: ratio >= 0.95,
    detail: `${oneQ}/${agentTurns.length} = ${(ratio * 100).toFixed(0)}%`,
  });

  // A6 — no leading framings.
  const offenders: string[] = [];
  for (const t of agentTurns) {
    const lower = t.content.toLowerCase();
    for (const phrase of BANNED_FRAMINGS) if (lower.includes(phrase)) offenders.push(phrase);
  }
  results.push({
    id: 'A6',
    label: 'No leading questions',
    pass: offenders.length === 0,
    detail: offenders.length ? `found: ${[...new Set(offenders)].join(', ')}` : 'ok',
  });

  // A7 — turn count within the persona ceiling.
  results.push({
    id: 'A7',
    label: `Turn count ≤ ${persona.turnLimit}`,
    pass: data.userTurnCount <= persona.turnLimit,
    detail: `${data.userTurnCount} user turns`,
  });

  // A8 — spec valid, email absent, provenance present, open_items reflect A2.
  const emailAbsent = !/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(data.spec.markdown);
  const provenance = /^provenance: stated$/m.test(data.spec.markdown);
  const openItems = data.spec.openItems.length > 0;
  results.push({
    id: 'A8',
    label: 'Spec valid; email absent; provenance present; open_items populated',
    pass: data.specValidation.ok && emailAbsent && provenance && openItems,
    detail: `valid=${data.specValidation.ok} emailAbsent=${emailAbsent} provenance=${provenance} openItems=${data.spec.openItems.length}${data.specValidation.ok ? '' : ' | ' + data.specValidation.errors.join('; ')}`,
  });

  // A9 — facet fidelity ≥ 80% (string containment first, model-graded fallback).
  let matched = 0;
  const unmatched: { facet: number; keyword: string }[] = [];
  for (const item of persona.groundTruth) {
    const facetText = byFacet.get(item.facet) ?? '';
    if (facetText.includes(item.keyword.toLowerCase())) matched += 1;
    else unmatched.push(item);
  }
  const total = persona.groundTruth.length;
  if (matched / total < 0.8 && unmatched.length > 0) {
    for (const item of unmatched) {
      const ok = await judgePresent(item.keyword, byFacet.get(item.facet) ?? '');
      if (ok) matched += 1;
    }
  }
  const fidelity = matched / total;
  results.push({
    id: 'A9',
    label: 'Facet fidelity ≥ 80%',
    pass: fidelity >= 0.8,
    detail: `${matched}/${total} = ${(fidelity * 100).toFixed(0)}%`,
  });

  return results;
}
