import { redirect } from 'next/navigation';
import {
  getIntervieweeByToken,
  getLatestSession,
  getCoverage,
  getActiveDraft,
  getElements,
  picklistOptions,
  getSession,
  listTurns,
} from '@/lib/db/queries';
import { openInterview } from '@/lib/engine/engine';
import { PICKLIST_FACETS } from '@/lib/facets/facets';
import { InterviewRoom } from '@/components/interview/InterviewRoom';
import { config } from '@/lib/config';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function InterviewPage({ params }: { params: { token: string } }) {
  const interviewee = await getIntervieweeByToken(params.token);
  if (!interviewee) redirect(`/i/${params.token}`);

  const latest = await getLatestSession(interviewee.id);
  if (!latest || latest.status === 'abandoned') redirect(`/i/${params.token}`);

  // Ensure the opening agent turn exists (idempotent). No-op once opened.
  if (latest.status === 'open') {
    await openInterview(latest.id);
  }

  const session = (await getSession(latest.id))!;
  const turns = (await listTurns(session.id)).map((t) => ({ seq: t.seq, speaker: t.speaker, content: t.content }));
  const coverage = (await getCoverage(session.id)).map((c) => ({ facetId: c.facetId, state: c.state }));
  const elements = (await getElements(session.id)).map((e) => ({
    facetId: e.facetId,
    elementId: e.elementId,
    state: e.state,
    summary: e.summary,
    naReason: e.naReason,
  }));

  // Pick-list option sets for the four closed-set facets (R2.1/R2.2).
  const options = Object.fromEntries(
    await Promise.all(
      PICKLIST_FACETS.map(async (f) => [f.id, await picklistOptions(session.id, f.id)] as const),
    ),
  );

  // R10.3 — anything unsubmitted when the tab went away comes back with them.
  const asked = turns.filter((t) => t.speaker === 'agent').length;
  const budget = {
    asked,
    globalCap: config.questionBudget,
    remaining: Math.max(0, config.questionBudget - asked),
    exhausted: asked >= config.questionBudget,
  };

  const active = await getActiveDraft(session.id);
  const draft = active ? { content: active.content, seq: active.seq, take: active.take } : null;

  return (
    <main className="pc-wrap">
      <span className="pc-secpill blue">
        Your interview
        <i className="pc-cap" aria-hidden="true" />
      </span>
      <div style={{ marginTop: 'var(--space-5)' }}>
        <InterviewRoom
          sessionId={session.id}
          processName={session.processName}
          initialTurns={turns}
          initialCoverage={coverage}
          initialElements={elements}
          initialOptions={options}
          initialDraft={draft}
          initialBudget={budget}
          initialStatus={session.status}
          startedAtMs={(session.startedAt ?? new Date()).getTime()}
          surveyUrl={config.surveyUrl}
          voiceEnabled={config.voiceEnabled}
        />
      </div>
    </main>
  );
}
