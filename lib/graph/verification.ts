/**
 * The verification gate (delta v1.1 R5.4 — a locked decision).
 *
 * To-be output is `proposed` and unverified until a human has ruled on **every**
 * change. Only a verified change-set may go into a handover report. This module
 * is the single authority on what "verified" means, so the UI, the export path
 * and any future report generator cannot disagree about it.
 *
 * Deliberately pure: it takes the change-set and the reviews and returns a
 * verdict. Nothing here reads a database or decides who a reviewer is.
 */
import type { Change, ChangeSet } from './schema';

export type Verdict = 'approved' | 'edited' | 'rejected';

export interface ReviewRecord {
  changeIndex: number;
  verdict: Verdict;
  editedDescription?: string | null;
  editedRationale?: string | null;
  note?: string;
  reviewer: string;
  reviewedAt: Date;
}

export interface ReviewedChange {
  index: number;
  /** The change as it now stands: the reviewer's wording where they edited it. */
  change: Change;
  /** What the generator originally proposed, kept for comparison and eval signal. */
  original: Change;
  review: ReviewRecord | null;
  /** True when this change should appear on the to-be diagram. */
  included: boolean;
}

export interface VerificationState {
  changes: ReviewedChange[];
  reviewed: number;
  total: number;
  approved: number;
  edited: number;
  rejected: number;
  /** Every change ruled on. Only then may this reach a handover report. */
  verified: boolean;
  /** Indices still awaiting a decision — what the reviewer is asked for next. */
  outstanding: number[];
}

/**
 * Apply a reviewer's edits to a change. The edit replaces the wording, never the
 * `resolvesAnnotationId` link: a reviewer may rephrase what a change does, but
 * they cannot re-point it at a different bottleneck without that being a
 * different change entirely.
 */
function withEdits(change: Change, review: ReviewRecord | null): Change {
  if (!review || review.verdict !== 'edited') return change;
  return {
    ...change,
    description: review.editedDescription?.trim() || change.description,
    rationale: review.editedRationale?.trim() || change.rationale,
  };
}

export function verificationState(
  changeSet: ChangeSet,
  reviews: readonly ReviewRecord[],
): VerificationState {
  const byIndex = new Map(reviews.map((r) => [r.changeIndex, r]));

  const changes: ReviewedChange[] = changeSet.changes.map((original, index) => {
    const review = byIndex.get(index) ?? null;
    return {
      index,
      original,
      change: withEdits(original, review),
      review,
      // Rejected changes stay on the record but leave the diagram — the reviewer
      // said they should not happen, and a to-be showing them would misrepresent
      // what was agreed.
      included: review !== null && review.verdict !== 'rejected',
    };
  });

  const count = (v: Verdict) => changes.filter((c) => c.review?.verdict === v).length;
  const outstanding = changes.filter((c) => c.review === null).map((c) => c.index);

  return {
    changes,
    total: changes.length,
    reviewed: changes.length - outstanding.length,
    approved: count('approved'),
    edited: count('edited'),
    rejected: count('rejected'),
    // An empty change-set is vacuously verified: there is nothing to rule on, and
    // nothing to put in a report either.
    verified: outstanding.length === 0,
    outstanding,
  };
}

/** The change-set as it stands after review — rejected changes removed. */
export function verifiedChangeSet(
  changeSet: ChangeSet,
  reviews: readonly ReviewRecord[],
): ChangeSet {
  const state = verificationState(changeSet, reviews);
  return {
    ...changeSet,
    verified: state.verified,
    changes: state.changes.filter((c) => c.included).map((c) => c.change),
  };
}

/**
 * Why a change-set may not be exported yet, in words a reviewer can act on.
 * Returns null when it may.
 */
export function blockedReason(state: VerificationState): string | null {
  if (state.total === 0) return 'There are no proposed changes to review.';
  if (state.verified) return null;
  const n = state.outstanding.length;
  return `${n} of ${state.total} proposed change${n === 1 ? '' : 's'} ${
    n === 1 ? 'has' : 'have'
  } not been reviewed. Every change must be approved, edited or rejected before this can go into a handover report.`;
}

/**
 * Human edits are eval signal (R5.4). This is what a future eval harness reads:
 * what the generator proposed, what the human made of it, and what they said.
 */
export interface EvalSignal {
  changeIndex: number;
  verdict: Verdict;
  proposedDescription: string;
  finalDescription: string;
  changed: boolean;
  note: string;
  reviewer: string;
  reviewedAt: string;
}

export function evalSignal(state: VerificationState): EvalSignal[] {
  return state.changes
    .filter((c) => c.review !== null)
    .map((c) => ({
      changeIndex: c.index,
      verdict: c.review!.verdict,
      proposedDescription: c.original.description,
      finalDescription: c.change.description,
      changed: c.change.description !== c.original.description,
      note: c.review!.note ?? '',
      reviewer: c.review!.reviewer,
      reviewedAt: c.review!.reviewedAt.toISOString(),
    }));
}
