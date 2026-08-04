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
  getElements,
  getCoverage,
  getInterviewee,
  getProject,
  getSession,
  listFindingsForSession,
  listLiveStatements,
} from '@/lib/db/queries';
import { FACETS, getElement } from '@/lib/facets/facets';
import { openItemsFromElements } from '@/lib/engine/priority';
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
  const session = await getSession(sessionId, db);
  if (!session) throw new Error(`No session ${sessionId}`);
  const interviewee = (await getInterviewee(session.intervieweeId, db))!;
  const project = (await getProject(session.projectId, db))!;

  const coverage = await getCoverage(sessionId, db);
  const stateByFacet = new Map<number, CoverageStateValue>(coverage.map((c) => [c.facetId, c.state]));

  const live = await listLiveStatements(sessionId, db);
  const statementsByFacet = new Map<number, DraftStatement[]>();
  for (const s of live) {
    const list = statementsByFacet.get(s.facetId) ?? [];
    list.push({ content: s.content, kind: s.kind, verbatim: s.verbatim });
    statementsByFacet.set(s.facetId, list);
  }

  const findings = await listFindingsForSession(sessionId, db);
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

  // Delta v1.1 R9.3: open_items is the seed list for follow-up sessions, so a
  // truncated interview must list every element it did not reach — not just the
  // facets the informant explicitly could not answer.
  const openItems = [
    ...findings.filter((f) => f.type === 'unknown_retarget').map((f) => f.detail || f.title),
    ...openItemsFromElements(await getElements(sessionId, db)),
  ];

  // Delta v1.1 R1: element-level coverage, so a reader can see what the checklist
  // actually closed rather than inferring it from twelve facet verdicts. Every N/A
  // carries the reason it was ruled out — an unexplained N/A is a silent gap.
  const elementRows = await getElements(sessionId, db);
  const elementCoverage = {
    captured: elementRows.filter((e) => e.state === 'captured').length,
    outstanding: elementRows.filter((e) => e.state === 'outstanding').length,
    not_applicable: elementRows.filter((e) => e.state === 'not_applicable').length,
  };
  const notApplicableItems = elementRows
    .filter((e) => e.state === 'not_applicable')
    .map((e) => ({
      element: e.elementId,
      facet: e.facetId,
      label: getElement(e.elementId)?.label ?? e.elementId,
      reason: e.naReason,
    }));

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
    `coverage: {answered: ${coverageSummary.answered}, unknown: ${coverageSummary.unknown}, not_applicable: ${coverageSummary.not_applicable}, elements_captured: ${elementCoverage.captured}, elements_outstanding: ${elementCoverage.outstanding}, elements_not_applicable: ${elementCoverage.not_applicable}}`,
  ];
  if (notApplicableItems.length === 0) {
    frontLines.push('not_applicable_items: []');
  } else {
    frontLines.push('not_applicable_items:');
    for (const item of notApplicableItems) {
      frontLines.push(
        `  - {facet: ${item.facet}, element: ${yamlString(item.element)}, label: ${yamlString(item.label)}, reason: ${yamlString(item.reason)}}`,
      );
    }
  }
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

      const facetElements = elementRows.filter((e) => e.facetId === facet.id);
      const stillOpen = facetElements.filter((e) => e.state === 'outstanding');

      let body: string;
      if (state === 'unknown_to_informant') {
        body = '_Not known to this informant._';
      } else if (state === 'not_applicable') {
        body = '_Not applicable to this process._';
      } else if (state === 'pending') {
        body = '_Not covered in this interview._';
      } else if (state === 'partial' && (statementsByFacet.get(facet.id) ?? []).length === 0) {
        // Partial with nothing recorded: say so rather than drafting from nothing.
        body = '_Only partly covered in this interview; nothing was recorded here._';
      } else {
        body = await draftFacet({
          facet,
          statements: statementsByFacet.get(facet.id) ?? [],
          processName: session.processName,
        });
      }

      // R9.4 — quality through honesty, not padding. A section with outstanding
      // elements says so, in the section itself, so a reader of the prose alone
      // cannot mistake a partial account for a complete one.
      const gapsBlock =
        stillOpen.length > 0 && state !== 'unknown_to_informant' && state !== 'not_applicable'
          ? `\n\n_Not covered in this interview: ${stillOpen
              .map((e) => (getElement(e.elementId)?.label ?? e.elementId).toLowerCase())
              .join('; ')}._`
          : '';

      const calloutBlock = facetFindings.length
        ? '\n\n' + facetFindings.map(findingCallout).join('\n\n')
        : '';
      return `${heading}\n\n${body}${gapsBlock}${calloutBlock}`;
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
