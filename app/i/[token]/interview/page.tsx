import { redirect } from 'next/navigation';
import { getIntervieweeByToken, getResumableSession, getCoverage, getSession } from '@/lib/db/queries';
import { CoverageRail } from '@/components/interview/CoverageRail';

export const dynamic = 'force-dynamic';

// Phase 2 shell. The live conversational engine (FR-3) lands here in Phase 3;
// for now this proves a session exists and renders the coverage rail.
export default function InterviewPage({ params }: { params: { token: string } }) {
  const interviewee = getIntervieweeByToken(params.token);
  if (!interviewee) redirect(`/i/${params.token}`);

  const session = getResumableSession(interviewee.id) ?? undefined;
  if (!session) redirect(`/i/${params.token}`);

  const activeSession = getSession(session.id)!;
  const coverage = getCoverage(activeSession.id);

  return (
    <main className="pc-wrap">
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 320px', gap: 'var(--space-8)' }}>
        <section>
          <span className="pc-secpill blue">
            Your interview
            <i className="pc-cap" aria-hidden="true" />
          </span>
          <h1 className="t-h3" style={{ marginTop: 'var(--space-5)' }}>
            {activeSession.processName ?? 'A process you run'}
          </h1>
          <p className="t-body" style={{ color: 'var(--fg-muted)', marginTop: 'var(--space-3)' }}>
            The conversation will appear here.
          </p>
        </section>
        <aside>
          <CoverageRail coverage={coverage} />
        </aside>
      </div>
    </main>
  );
}
