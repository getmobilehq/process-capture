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
 * Legal transitions, exactly as specified in FR-3.2:
 *   pending → partial | answered | unknown_to_informant | not_applicable
 *   partial → answered | unknown_to_informant
 * Terminal states have no outgoing transitions.
 */
const LEGAL_TRANSITIONS: Record<CoverageStateValue, readonly CoverageStateValue[]> = {
  pending: ['partial', 'answered', 'unknown_to_informant', 'not_applicable'],
  partial: ['answered', 'unknown_to_informant'],
  answered: [],
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
