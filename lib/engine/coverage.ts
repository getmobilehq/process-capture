/**
 * Coverage state machine (BUILD-REQUIREMENTS P3, FR-3.2).
 *
 * Deterministic server-owned rules for how a facet's coverage state may change.
 * The model proposes transitions via set_coverage; the server validates them here
 * and rejects anything illegal (P1 — the model proposes, the server disposes).
 */

export type CoverageStateValue =
  | 'pending'
  | 'partial'
  | 'answered'
  | 'unknown_to_informant'
  | 'not_applicable';

export const COVERAGE_STATES: readonly CoverageStateValue[] = [
  'pending',
  'partial',
  'answered',
  'unknown_to_informant',
  'not_applicable',
];

/** Terminal states end a facet's life; once reached they are immutable (P3). */
export const TERMINAL_STATES: readonly CoverageStateValue[] = [
  'answered',
  'unknown_to_informant',
  'not_applicable',
];

/**
 * Legal transitions, per FR-3.2 with one addition from delta v1.1.
 *
 * `answered → unknown_to_informant` is now legal. Since R1 (DL.2) the model cannot
 * declare a facet answered — that state is *derived* from the checklist. So a
 * facet can reach `answered` because elements were closed from adjacent material,
 * while the informant's actual position is "that isn't mine to answer". An honest
 * unknown is strictly more truthful than derived coverage and must be able to
 * override it; the reverse is never allowed, so this stays a one-way door and P3
 * still holds.
 *
 * Found by the live eval: a rambling informant produced facet 9 = answered with a
 * retarget finding raised — the finding landed, the coverage correction was
 * rejected as an illegal transition, and the spec claimed knowledge nobody had.
 */
const LEGAL_TRANSITIONS: Record<CoverageStateValue, readonly CoverageStateValue[]> = {
  pending: ['partial', 'answered', 'unknown_to_informant', 'not_applicable'],
  partial: ['answered', 'unknown_to_informant'],
  answered: ['unknown_to_informant'],
  unknown_to_informant: [],
  not_applicable: [],
};

export function isTerminal(state: CoverageStateValue): boolean {
  return TERMINAL_STATES.includes(state);
}

export function isCoverageState(value: string): value is CoverageStateValue {
  return COVERAGE_STATES.includes(value as CoverageStateValue);
}

/** True iff moving from → to is a legal coverage transition. */
export function canTransition(from: CoverageStateValue, to: CoverageStateValue): boolean {
  return LEGAL_TRANSITIONS[from].includes(to);
}

export class IllegalCoverageTransitionError extends Error {
  constructor(
    readonly from: CoverageStateValue,
    readonly to: CoverageStateValue,
  ) {
    super(`Illegal coverage transition: ${from} → ${to}`);
    this.name = 'IllegalCoverageTransitionError';
  }
}

/** Throws IllegalCoverageTransitionError if the transition is not permitted. */
export function assertTransition(from: CoverageStateValue, to: CoverageStateValue): void {
  if (!canTransition(from, to)) {
    throw new IllegalCoverageTransitionError(from, to);
  }
}

/** A facet is resolved once it reaches a terminal state (P3 — no silent gaps). */
export function isResolved(state: CoverageStateValue): boolean {
  return isTerminal(state);
}

/** A session may only complete when no facet is pending or partial (FR-3.2). */
export function allResolved(states: readonly CoverageStateValue[]): boolean {
  return states.every(isResolved);
}

// ── Checklist elements (delta v1.1 R1) ──────────────────────────────────────

export type ElementStateValue = 'outstanding' | 'captured' | 'not_applicable';

export const ELEMENT_STATES: readonly ElementStateValue[] = [
  'outstanding',
  'captured',
  'not_applicable',
];

export function isElementState(value: string): value is ElementStateValue {
  return ELEMENT_STATES.includes(value as ElementStateValue);
}

/** Captured and N/A both close an element; only outstanding keeps it open. */
export function isElementClosed(state: ElementStateValue): boolean {
  return state === 'captured' || state === 'not_applicable';
}

export interface ElementSnapshot {
  elementId: string;
  state: ElementStateValue;
}

/**
 * Derive a facet's coverage state from its checklist (R1.1). The meter is a
 * function of the elements — it is never set independently, so it cannot claim
 * more than the checklist can show.
 *
 * `unknownToInformant` is the one facet-level override: an honest "not mine to
 * answer" (P3) closes the facet regardless of how many elements are outstanding.
 */
export function deriveFacetState(
  elements: readonly ElementSnapshot[],
  opts: { unknownToInformant?: boolean } = {},
): CoverageStateValue {
  if (opts.unknownToInformant) return 'unknown_to_informant';
  if (elements.length === 0) return 'pending';

  const captured = elements.filter((e) => e.state === 'captured').length;
  const notApplicable = elements.filter((e) => e.state === 'not_applicable').length;

  // Every element ruled out — the facet itself does not apply.
  if (notApplicable === elements.length) return 'not_applicable';

  const closed = captured + notApplicable;
  if (closed === elements.length) return 'answered';
  if (closed > 0) return 'partial';
  return 'pending';
}

export interface FacetMeter {
  facetId: number;
  state: CoverageStateValue;
  captured: number;
  notApplicable: number;
  outstanding: number;
  total: number;
}

/**
 * The rail's per-facet reading. Deliberately returns counts rather than a
 * percentage — R1.1 forbids a bare percentage, because a number tells the
 * interviewee nothing about what is still wanted.
 */
export function facetMeter(
  facetId: number,
  elements: readonly ElementSnapshot[],
  opts: { unknownToInformant?: boolean } = {},
): FacetMeter {
  const captured = elements.filter((e) => e.state === 'captured').length;
  const notApplicable = elements.filter((e) => e.state === 'not_applicable').length;
  return {
    facetId,
    state: deriveFacetState(elements, opts),
    captured,
    notApplicable,
    outstanding: elements.length - captured - notApplicable,
    total: elements.length,
  };
}
