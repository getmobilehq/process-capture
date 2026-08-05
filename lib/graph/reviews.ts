/**
 * Reading review rows for the verification gate (R5.4, extended to R5.5).
 *
 * Sits between the database and the pure gate module: routes cannot export
 * helpers, and `verification.ts` must stay free of database access so it can be
 * tested as a function of its inputs.
 */
import { listChangeReviews } from '@/lib/db/queries';
import type { ReviewRecord } from './verification';

export async function reviewRecords(
  sessionId: string,
  specVersion: number,
  subject: 'change' | 'opportunity' = 'change',
): Promise<ReviewRecord[]> {
  return (await listChangeReviews(sessionId, specVersion, subject)).map((r) => ({
    changeIndex: r.changeIndex,
    verdict: r.verdict,
    editedDescription: r.editedDescription,
    editedRationale: r.editedRationale,
    note: r.note,
    reviewer: r.reviewer,
    reviewedAt: r.reviewedAt,
  }));
}
