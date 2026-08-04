import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  getInterviewee,
  getProject, getLatestSpec, getSession } from '@/lib/db/queries';
import { SpecDetail } from '@/components/graph/SpecDetail';

export const dynamic = 'force-dynamic';

/**
 * Spec detail page (delta v1.1 R5.6). Console-only — reached from the register.
 * The Process map tab lives here because the map is analysis for the architecture
 * team, not something the informant is shown.
 */
export default function SpecDetailPage({ params }: { params: { sessionId: string } }) {
  const session = getSession(params.sessionId);
  if (!session) redirect('/console');

  const spec = getLatestSpec(session.id);
  const interviewee = getInterviewee(session.intervieweeId);
  const project = getProject(session.projectId);

  return (
    <main className="pc-wrap">
      {/* The spec page is reached from a campaign register and previously dead-ended
          there — no way back without the browser button. */}
      <nav className="pc-crumbs" aria-label="Breadcrumb">
        <Link href="/console">Campaigns</Link>
        <span aria-hidden="true">/</span>
        {project ? (
          <Link href={`/console/projects/${project.id}?tab=register`}>{project.name}</Link>
        ) : (
          <span>Campaign</span>
        )}
        <span aria-hidden="true">/</span>
        <span aria-current="page">{session.processName ?? 'Unnamed process'}</span>
      </nav>

      <span className="pc-secpill purple">
        Process architect
        <i className="pc-cap" aria-hidden="true" />
      </span>

      <h1 className="t-h2" style={{ marginTop: 'var(--space-5)' }}>
        {session.processName ?? 'Unnamed process'}.
      </h1>

      {spec ? (
        <div style={{ marginTop: 'var(--space-5)' }}>
          <SpecDetail
            sessionId={session.id}
            processName={session.processName ?? 'Unnamed process'}
            informant={interviewee?.fullName ?? 'the informant'}
            markdown={spec.markdown}
            specVersion={spec.version}
          />
        </div>
      ) : (
        <p className="t-body" style={{ marginTop: 'var(--space-5)' }}>
          This interview has not produced a specification yet.
        </p>
      )}
    </main>
  );
}
