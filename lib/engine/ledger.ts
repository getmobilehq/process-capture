/**
 * The claims ledger (delta v1.1 R4.3).
 *
 * A running record of what this session has actually established: claim, the facet
 * element it closed, its provenance, and the turn it came from. Follow-up
 * generation reads *this*, never the raw transcript — which is what guarantees the
 * interview never asks for something it has already been told.
 *
 * It is a projection, not a new source of truth: everything here is derived from
 * the append-only statements and the element checklist, so the ledger cannot drift
 * from the record it describes (P1).
 */
import type { DB } from '@/lib/db';
import { getDb } from '@/lib/db';
import { getElements, listEntityMentions, listLiveStatements } from '@/lib/db/queries';
import { getElement, getFacet } from '@/lib/facets/facets';

/**
 * Provenance classes (delta cross-cutting). `stated` and `confirmed-suggestion`
 * are reachable today; `documented`, `corroborated` and `conflicting` arrive with
 * artefact ingestion (R3) and are declared here so the ledger's shape does not
 * change when they do.
 */
export type Provenance =
  | 'stated'
  | 'documented'
  | 'corroborated'
  | 'conflicting'
  | 'confirmed-suggestion';

export interface LedgerEntry {
  facetId: number;
  facetName: string;
  /** The element this claim closed, where it closed one. */
  elementId?: string;
  elementLabel?: string;
  claim: string;
  provenance: Provenance;
  /** Turn reference, where the claim came from a recorded statement. */
  turnRef?: string;
}

/**
 * Build the ledger for a session. Ordered by facet so a reader — human or model —
 * can see the shape of what is known at a glance.
 */
export async function buildLedger(
  sessionId: string,
  db: DB = getDb(),
): Promise<LedgerEntry[]> {
  const entries: LedgerEntry[] = [];

  // Captured checklist elements: the strongest signal that something is settled.
  for (const e of await getElements(sessionId, db)) {
    if (e.state !== 'captured') continue;
    const element = getElement(e.elementId);
    entries.push({
      facetId: e.facetId,
      facetName: getFacet(e.facetId).name,
      elementId: e.elementId,
      elementLabel: element?.label,
      claim: e.summary,
      provenance: 'stated',
    });
  }

  // Statements not tied to a specific element still count as things they told us.
  for (const s of await listLiveStatements(sessionId, db)) {
    entries.push({
      facetId: s.facetId,
      facetName: getFacet(s.facetId).name,
      claim: s.content,
      provenance: 'stated',
      turnRef: s.id,
    });
  }

  // Entities the informant named or ticked (R2) are claims too.
  for (const m of await listEntityMentions(sessionId, db)) {
    entries.push({
      facetId: m.facetId,
      facetName: getFacet(m.facetId).name,
      claim: `Named entity ${m.entityId}`,
      provenance: m.source === 'taxonomy' ? 'confirmed-suggestion' : 'stated',
    });
  }

  return entries.sort((a, b) => a.facetId - b.facetId);
}

/**
 * Everything already established, rendered for the prompt (R4.3). Deliberately
 * compact: its job is to stop repeat questions, not to restate the transcript.
 */
export function ledgerBlock(entries: readonly LedgerEntry[]): string {
  if (entries.length === 0) return '';
  const byFacet = new Map<number, LedgerEntry[]>();
  for (const e of entries) {
    const list = byFacet.get(e.facetId) ?? [];
    list.push(e);
    byFacet.set(e.facetId, list);
  }

  const blocks = [...byFacet.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([facetId, list]) => {
      const lines = list
        .filter((e) => e.claim.trim() !== '')
        .map((e) => `    · ${e.claim} [${e.provenance}]`);
      if (lines.length === 0) return '';
      return `  Facet ${facetId} — ${list[0].facetName}:\n${lines.join('\n')}`;
    })
    .filter(Boolean);

  return [
    'ALREADY ESTABLISHED (the claims ledger — never ask for any of this again):',
    ...blocks,
  ].join('\n');
}

/** True when a facet already carries a claim — used to suppress repeat probing. */
export function facetHasClaims(entries: readonly LedgerEntry[], facetId: number): boolean {
  return entries.some((e) => e.facetId === facetId && e.claim.trim() !== '');
}
