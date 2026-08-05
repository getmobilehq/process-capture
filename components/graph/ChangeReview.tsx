'use client';

import { useState } from 'react';
import type { Change } from '@/lib/graph/schema';

/**
 * Per-change review (delta v1.1 R5.4 — a locked decision).
 *
 * Every proposed change must be approved, edited or rejected by a person before
 * the set can go into a handover report. Reviewing is deliberately per change:
 * approving four and rejecting a fifth is the normal outcome, and a single
 * "approve all" button would turn the gate into a formality.
 *
 * Each card shows what the change resolves and why, because a reviewer cannot
 * judge a proposal they have to go elsewhere to understand.
 */
export interface ReviewedChangeView {
  index: number;
  change: Change;
  original: Change;
  review: {
    verdict: 'approved' | 'edited' | 'rejected';
    note?: string;
    reviewer: string;
    reviewedAt: string;
  } | null;
  included: boolean;
}

export interface ReviewState {
  changes: ReviewedChangeView[];
  reviewed: number;
  total: number;
  approved: number;
  edited: number;
  rejected: number;
  verified: boolean;
  outstanding: number[];
}

const VERDICT_LABEL = {
  approved: 'Approved',
  edited: 'Edited',
  rejected: 'Rejected',
} as const;

export function ChangeReview({
  state,
  blocked,
  onReview,
  busy = false,
}: {
  state: ReviewState;
  blocked: string | null;
  onReview: (
    index: number,
    verdict: 'approved' | 'edited' | 'rejected',
    extra?: { editedDescription?: string; note?: string },
  ) => void;
  busy?: boolean;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState('');

  return (
    <section className="pc-review" aria-label="Change review">
      <div className="pc-review-head">
        <div>
          <b>Review before this can be shared</b>
          <span className="pc-review-count">
            {state.reviewed} of {state.total} reviewed
            {state.rejected > 0 && ` · ${state.rejected} rejected`}
          </span>
        </div>
        <span className={`pc-review-badge ${state.verified ? 'ok' : 'pending'}`}>
          {state.verified ? 'Verified' : 'Not yet verified'}
        </span>
      </div>

      {blocked && <p className="pc-review-blocked">{blocked}</p>}

      <ul className="pc-review-list">
        {state.changes.map((c) => (
          <li key={c.index} className={`pc-review-item ${c.review?.verdict ?? 'unreviewed'}`}>
            <div className="pc-review-item-head">
              <span className="pc-review-op">{c.change.op}</span>
              <span className="pc-review-target">{c.change.target}</span>
              {c.review && (
                <span className={`pc-review-verdict ${c.review.verdict}`}>
                  {VERDICT_LABEL[c.review.verdict]}
                </span>
              )}
            </div>

            <p className="pc-review-desc">{c.change.description}</p>
            {c.review?.verdict === 'edited' &&
              c.original.description !== c.change.description && (
                <p className="pc-review-was">
                  Originally proposed: “{c.original.description}”
                </p>
              )}
            <p className="pc-review-why">
              Resolves {c.change.resolvesAnnotationId.join(', ')} · {c.change.rationale}
            </p>

            {editing === c.index ? (
              <div className="pc-review-editor">
                <textarea
                  className="pc-review-textarea"
                  rows={3}
                  autoFocus
                  value={draft}
                  placeholder="Reword the change…"
                  onChange={(e) => setDraft(e.target.value)}
                />
                <input
                  className="pc-check-nainput"
                  value={note}
                  placeholder="Why (optional) — this is fed back to improve the generator"
                  onChange={(e) => setNote(e.target.value)}
                />
                <span className="pc-review-actions">
                  <button
                    type="button"
                    className="pc-btn sm"
                    disabled={busy || draft.trim() === ''}
                    onClick={() => {
                      onReview(c.index, 'edited', {
                        editedDescription: draft.trim(),
                        note: note.trim(),
                      });
                      setEditing(null);
                      setDraft('');
                      setNote('');
                    }}
                  >
                    Save edit
                  </button>
                  <button
                    type="button"
                    className="pc-btn ghost sm"
                    onClick={() => setEditing(null)}
                  >
                    Cancel
                  </button>
                </span>
              </div>
            ) : (
              <span className="pc-review-actions">
                <button
                  type="button"
                  className="pc-btn sm"
                  disabled={busy}
                  onClick={() => onReview(c.index, 'approved')}
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="pc-btn ghost sm"
                  disabled={busy}
                  onClick={() => {
                    setEditing(c.index);
                    setDraft(c.change.description);
                    setNote('');
                  }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="pc-btn ghost sm danger-outline"
                  disabled={busy}
                  onClick={() => onReview(c.index, 'rejected')}
                >
                  Reject
                </button>
                {c.review && (
                  <span className="pc-review-meta">
                    {c.review.reviewer} ·{' '}
                    {new Date(c.review.reviewedAt).toLocaleDateString('en-GB')}
                  </span>
                )}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
