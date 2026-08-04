/**
 * Console read models (BUILD-REQUIREMENTS FR-1.4, FR-1.6). Composed from the query
 * module — no direct table access. The register rolls up each interviewee's latest
 * session; the conflict view surfaces cross-informant rule/metric statements for a
 * human to adjudicate (never auto-merged, P2).
 */
import type { DB } from '@/lib/db';
import { getDb } from '@/lib/db';
import {
  coverageSummary,
  getInterviewee,
  getLatestSession,
  getLatestSpec,
  listInterviewees,
  listLiveStatements,
  listSessionsForProject,
} from '@/lib/db/queries';
import { getFacet } from '@/lib/facets/facets';
import type { Interviewee, Session } from '@/lib/db/schema';

export interface RegisterRow {
  interviewee: Interviewee;
  session: Session | undefined;
  coverage: ReturnType<typeof coverageSummary> | null;
  specVersion: number | null;
}

export async function buildRegister(projectId: string, db: DB = getDb()): RegisterRow[] {
  return (await listInterviewees(projectId, db)).map((interviewee) => {
    const session = await getLatestSession(interviewee.id, db);
    const coverage = session ? await coverageSummary(session.id, db) : null;
    const spec = session ? await getLatestSpec(session.id, db) : null;
    return { interviewee, session, coverage, specVersion: spec?.version ?? null };
  });
}

export interface ConflictEntry {
  statementId: string;
  intervieweeName: string;
  role: string;
  content: string;
  kind: string;
}
export interface ConflictGroup {
  facetId: number;
  facetName: string;
  entries: ConflictEntry[];
  /** Lightweight heuristic: do the numeric values differ across entries? */
  numericDiffer: boolean;
}

function numbersIn(text: string): string[] {
  return (text.match(/\d[\d,.]*/g) ?? []).map((n) => n.replace(/[,]/g, ''));
}

function numericDiffer(entries: ConflictEntry[]): boolean {
  const sets = entries.map((e) => numbersIn(e.content).join('|'));
  return new Set(sets).size > 1;
}

export async function buildConflicts(projectId: string, db: DB = getDb()): ConflictGroup[] {
  const byFacet = new Map<number, ConflictEntry[]>();

  for (const session of await listSessionsForProject(projectId, db)) {
    const interviewee = await getInterviewee(session.intervieweeId, db);
    if (!interviewee) continue;
    const live = (await listLiveStatements(session.id, db)).filter(
      (s) => s.kind === 'rule' || s.kind === 'metric',
    );
    for (const st of live) {
      const list = byFacet.get(st.facetId) ?? [];
      list.push({
        statementId: st.id,
        intervieweeName: interviewee.fullName,
        role: interviewee.role,
        content: st.content,
        kind: st.kind,
      });
      byFacet.set(st.facetId, list);
    }
  }

  const groups: ConflictGroup[] = [];
  for (const [facetId, entries] of byFacet) {
    const informants = new Set(entries.map((e) => e.intervieweeName));
    if (informants.size >= 2) {
      groups.push({
        facetId,
        facetName: getFacet(facetId).name,
        entries,
        numericDiffer: numericDiffer(entries),
      });
    }
  }
  groups.sort((a, b) => a.facetId - b.facetId);
  return groups;
}
