/**
 * Information-value ordering (delta v1.1 R9.2).
 *
 * Shared by the bounded interview (R9) and adaptive follow-up selection (R4.2) —
 * the delta says implement once, so this module is the single ranking authority.
 *
 * The ranking exists so that budget exhaustion truncates from the *least*
 * important end. If the informant walks away at question 14 of 25, what they did
 * answer should be the material that matters.
 */
import { FACETS, getElement, getFacet } from '@/lib/facets/facets';
import type { CoverageStateValue, ElementStateValue } from './coverage';

/**
 * Facets the specification is not much use without. Identity, triggers, workflow
 * and rules carry the shape of the process; everything else enriches it.
 */
export const MANDATORY_CORE_FACETS: readonly number[] = [1, 3, 5, 6];

export type CandidateTier =
  | 'conflicting'
  | 'mandatory_core'
  | 'nearly_complete'
  | 'remaining';

/** Rank order. Lower sorts first. */
const TIER_RANK: Record<CandidateTier, number> = {
  conflicting: 0,
  mandatory_core: 1,
  nearly_complete: 2,
  remaining: 3,
};

export interface QuestionCandidate {
  facetId: number;
  elementId: string;
  /** Plain-language label, as shown to the informant. */
  label: string;
  tier: CandidateTier;
  /** What prompted this — every follow-up must be able to cite its reason (R4.2). */
  because: string;
}

export interface RankingInput {
  coverage: readonly { facetId: number; state: CoverageStateValue }[];
  elements: readonly { facetId: number; elementId: string; state: ElementStateValue }[];
  /** Claims where an interview answer and an artefact disagree (R3.2 / R4.2). */
  conflictingElementIds?: readonly string[];
}

/**
 * A facet is "nearly complete" when one more answer would close it. Finishing a
 * facet is worth more than starting one: a facet closed is a facet the modeller
 * can use.
 */
function nearlyComplete(outstanding: number): boolean {
  return outstanding === 1;
}

/**
 * Every outstanding element, ranked by information value. Terminal facets are
 * excluded — an honest unknown or a not-applicable is settled, and re-asking it
 * would be exactly the badgering R4 exists to prevent.
 */
export function rankCandidates(input: RankingInput): QuestionCandidate[] {
  const stateByFacet = new Map(input.coverage.map((c) => [c.facetId, c.state]));
  const conflicting = new Set(input.conflictingElementIds ?? []);

  const outstandingByFacet = new Map<number, number>();
  for (const e of input.elements) {
    if (e.state !== 'outstanding') continue;
    outstandingByFacet.set(e.facetId, (outstandingByFacet.get(e.facetId) ?? 0) + 1);
  }

  const candidates: QuestionCandidate[] = [];

  for (const e of input.elements) {
    if (e.state !== 'outstanding') continue;

    const facetState = stateByFacet.get(e.facetId) ?? 'pending';
    // unknown_to_informant / not_applicable / answered are settled (P3).
    if (facetState === 'unknown_to_informant' || facetState === 'not_applicable') continue;

    const label = getElement(e.elementId)?.label ?? e.elementId;
    const facetName = getFacet(e.facetId).name;

    let tier: CandidateTier;
    let because: string;

    if (conflicting.has(e.elementId)) {
      tier = 'conflicting';
      because = 'an uploaded document disagrees with what was said in the interview';
    } else if (MANDATORY_CORE_FACETS.includes(e.facetId)) {
      tier = 'mandatory_core';
      because = `${facetName} is core to the specification and this is still open`;
    } else if (nearlyComplete(outstandingByFacet.get(e.facetId) ?? 0)) {
      tier = 'nearly_complete';
      because = `one more answer closes ${facetName}`;
    } else {
      tier = 'remaining';
      because = `${facetName} is still open`;
    }

    candidates.push({ facetId: e.facetId, elementId: e.elementId, label, tier, because });
  }

  return candidates.sort(
    (a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier] || a.facetId - b.facetId,
  );
}

/** The single highest-value question left — what a graceful finish asks (R9.3). */
export function highestValueCandidate(input: RankingInput): QuestionCandidate | null {
  return rankCandidates(input)[0] ?? null;
}

/**
 * The follow-ups worth asking this turn (R4.2). At most two: the interview must
 * feel like a competent listener, not a questionnaire.
 */
export function selectFollowUps(input: RankingInput, limit = 2): QuestionCandidate[] {
  return rankCandidates(input).slice(0, limit);
}

export interface BudgetState {
  asked: number;
  globalCap: number;
  /** True once the budget is spent — the engine moves to a graceful finish. */
  exhausted: boolean;
  remaining: number;
}

/**
 * The felt horizon (R9.1). The counter is shown to the informant precisely so the
 * interview has an end they can see coming.
 */
export function budgetState(asked: number, globalCap: number): BudgetState {
  const remaining = Math.max(0, globalCap - asked);
  return { asked, globalCap, remaining, exhausted: remaining === 0 };
}

/**
 * Whether a facet has had its share of follow-ups (R9.1). A soft cap: it stops the
 * interview grinding on one facet while others sit untouched, and does not prevent
 * the informant volunteering more.
 */
export function facetFollowUpsSpent(
  askedPerFacet: Readonly<Record<number, number>>,
  facetId: number,
  softCap: number,
): boolean {
  return (askedPerFacet[facetId] ?? 0) >= softCap;
}

/** Outstanding elements as open items for the spec front-matter (R9.3). */
export function openItemsFromElements(
  elements: readonly { facetId: number; elementId: string; state: ElementStateValue }[],
): string[] {
  return elements
    .filter((e) => e.state === 'outstanding')
    .map((e) => {
      const label = getElement(e.elementId)?.label ?? e.elementId;
      const facet = FACETS.find((f) => f.id === e.facetId);
      return `Facet ${e.facetId} (${facet?.name ?? 'unknown'}) — not covered: ${label.toLowerCase()}`;
    });
}
