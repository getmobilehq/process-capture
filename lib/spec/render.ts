/**
 * Specification renderer (BUILD-REQUIREMENTS FR-5). Deterministic scaffolding
 * built entirely in code — the model never writes the frontmatter or the structure
 * (P1, P4). Per-facet prose is drafted from that facet's live statements only;
 * unknown / not-applicable facets get a fixed one-line template plus any finding
 * reference. Email never appears (P7).
 */
import type { DB } from '@/lib/db';
import { getDb } from '@/lib/db';
import {
  coverageSummary as coverageSummaryQuery,
  getCoverage,
  getInterviewee,
  getProject,
  getSession,
  listFindingsForSession,
  listLiveStatements,
} from '@/lib/db/queries';
import { FACETS } from '@/lib/facets/facets';
import type { CoverageStateValue } from '@/lib/engine/coverage';
import type { Finding } from '@/lib/db/schema';
import { draftFacet, type DraftStatement } from './draft';

export interface RenderedSpec {
  markdown: string;
  coverageSummary: { answered: number; unknown: number; not_applicable: number };
  openItems: string[];
}

const STATE_HEADING: Record<CoverageStateValue, string> = {
  pending: 'not covered',
  partial: 'partial',
  answered: 'answered',
  unknown_to_informant: 'not known to informant',
  not_applicable: 'not applicable',
};

function yamlString(v: string): string {
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`;
}

function toDate(d: Date | null): string {
  return (d ?? new Date()).toISOString().slice(0, 10); // YYYY-MM-DD
}

function findingCallout(f: Finding): string {
  const type = f.type.replace(/_/g, ' ').toUpperCase();
  const lines = [`> **FINDING · ${type}** ${f.title}`];
  if (f.detail) lines.push(`> ${f.detail}`);
  if (f.routedTo) lines.push(`> Routed to: ${f.routedTo}`);
  return lines.join('\n');
}

export async function renderSpec(sessionId: string, db: DB = getDb()): Promise<RenderedSpec> {
  const session = getSession(sessionId, db);
  if (!session) throw new Error(`No session ${sessionId}`);
  const interviewee = getInterviewee(session.intervieweeId, db)!;
  const project = getProject(session.projectId, db)!;

  const coverage = getCoverage(sessionId, db);
  const stateByFacet = new Map<number, CoverageStateValue>(coverage.map((c) => [c.facetId, c.state]));

  const live = listLiveStatements(sessionId, db);
  const statementsByFacet = new Map<number, DraftStatement[]>();
  for (const s of live) {
    const list = statementsByFacet.get(s.facetId) ?? [];
    list.push({ content: s.content, kind: s.kind, verbatim: s.verbatim });
    statementsByFacet.set(s.facetId, list);
  }

  const findings = listFindingsForSession(sessionId, db);
  const findingsByFacet = new Map<number, Finding[]>();
  for (const f of findings) {
    const list = findingsByFacet.get(f.facetId) ?? [];
    list.push(f);
    findingsByFacet.set(f.facetId, list);
  }

  const summary = coverageSummaryQuery(sessionId, db);
  const coverageSummary = {
    answered: summary.answered,
    unknown: summary.unknown,
    not_applicable: summary.not_applicable,
  };

  const openItems = findings
    .filter((f) => f.type === 'unknown_retarget')
    .map((f) => f.detail || f.title);

  const processName = session.processName ?? 'Unnamed process';
  const durationMin = Math.round(session.durationSec / 60);

  // ── Frontmatter (built in code; exact keys — FR-5.2) ──────────────────────
  const frontLines = [
    '---',
    `process_name: ${yamlString(processName)}`,
    `department: ${yamlString(project.department)}`,
    `project_id: ${yamlString(project.id)}`,
    `informant: {name: ${yamlString(interviewee.fullName)}, role: ${yamlString(interviewee.role)}}`,
    `interviewed: ${toDate(session.completedAt)}`,
    `duration_min: ${durationMin}`,
    'provenance: stated',
    `coverage: {answered: ${coverageSummary.answered}, unknown: ${coverageSummary.unknown}, not_applicable: ${coverageSummary.not_applicable}}`,
  ];
  if (openItems.length === 0) {
    frontLines.push('open_items: []');
  } else {
    frontLines.push('open_items:');
    for (const item of openItems) frontLines.push(`  - ${yamlString(item)}`);
  }
  frontLines.push('---');

  // ── Body (twelve sections in facet order — FR-5.3) ────────────────────────
  const sections = await Promise.all(
    FACETS.map(async (facet) => {
      const state = stateByFacet.get(facet.id) ?? 'pending';
      const heading = `## ${facet.id}. ${facet.name} — ${STATE_HEADING[state]}`;
      const facetFindings = findingsByFacet.get(facet.id) ?? [];

      let body: string;
      if (state === 'unknown_to_informant') {
        body = '_Not known to this informant._';
      } else if (state === 'not_applicable') {
        body = '_Not applicable to this process._';
      } else if (state === 'pending') {
        body = '_Not covered in this interview._';
      } else {
        body = await draftFacet({
          facet,
          statements: statementsByFacet.get(facet.id) ?? [],
          processName: session.processName,
        });
      }

      const calloutBlock = facetFindings.length
        ? '\n\n' + facetFindings.map(findingCallout).join('\n\n')
        : '';
      return `${heading}\n\n${body}${calloutBlock}`;
    }),
  );

  const markdown = [
    frontLines.join('\n'),
    '',
    `# Process specification — ${processName}`,
    '',
    '_Provenance: stated. Every statement below is attributed to the named informant and reflects the process as they described it._',
    '',
    sections.join('\n\n'),
    '',
  ].join('\n');

  return { markdown, coverageSummary, openItems };
}
