'use client';

import type { Assessment, Verdict } from '@/lib/graph/assessment';
import type { Segment } from '@/lib/graph/segments';

/**
 * The stakeholder readout (R5.8).
 *
 * Deliberately a page rather than badges on a diagram. Badges serve an architect
 * who is already looking at the map; a stakeholder needs something they can read,
 * disagree with, and take into a meeting. The verdict comes first because it may be
 * the only thing read, and what could not be judged comes last but is never
 * omitted — an assessment that hides its own gaps invites more confidence than it
 * has earned.
 */
const VERDICT_COPY: Record<Verdict, { title: string; tone: string; gloss: string }> = {
  'strong-candidate': {
    title: 'Strong candidate',
    tone: 'strong',
    gloss: 'A large, connected part of this process is system work on data already held.',
  },
  'partial-candidate': {
    title: 'Partial candidate',
    tone: 'partial',
    gloss: 'Specific parts are worth pursuing. The process as a whole is not.',
  },
  'poor-candidate': {
    title: 'Poor candidate',
    tone: 'poor',
    gloss: 'Judgement, approval authority or physical presence dominate this work.',
  },
  'insufficient-evidence': {
    title: 'Not enough evidence',
    tone: 'unknown',
    gloss: 'What was captured does not support a judgement either way.',
  },
};

const LABEL_COPY: Record<string, string> = {
  automatable: 'Could be automated',
  assistable: 'Could be assisted',
  'human-required': 'Needs a person',
  unclassified: 'Not judged',
};

export function AutomationAssessment({
  assessment,
  processName,
  onDownload,
}: {
  assessment: Assessment & { derived: Segment[]; signals: { totalActivities: number; automationShare: number; unclassifiedShare: number } };
  processName: string;
  onDownload: () => void;
}) {
  const v = VERDICT_COPY[assessment.verdict];
  const bySegment = new Map(assessment.segments.map((s) => [s.segmentId, s]));
  const runs = assessment.derived.filter(
    (s) => s.label === 'automatable' || s.label === 'assistable',
  );
  const pct = (n: number) => `${Math.round(n * 100)}%`;

  return (
    <section className="pc-assess" aria-label="Automation assessment">
      <div className={`pc-assess-verdict ${v.tone}`}>
        <span className="pc-assess-badge">{v.title}</span>
        <h3>{assessment.headline}</h3>
        <p className="pc-assess-gloss">{v.gloss}</p>
      </div>

      <p className="pc-assess-reasoning">{assessment.reasoning}</p>

      <div className="pc-assess-figures">
        <span>
          <b>{assessment.signals.totalActivities}</b> steps assessed
        </span>
        <span>
          <b>{pct(assessment.signals.automationShare)}</b> automatable or assistable
        </span>
        <span>
          <b>{runs.length}</b> candidate {runs.length === 1 ? 'segment' : 'segments'}
        </span>
        <span>
          <b>{pct(assessment.signals.unclassifiedShare)}</b> not judged
        </span>
      </div>

      {runs.length > 0 && (
        <>
          <h4 className="pc-assess-h">Where the opportunity is</h4>
          <ol className="pc-assess-segments">
            {runs.map((seg) => {
              const written = bySegment.get(seg.id);
              return (
                <li key={seg.id}>
                  <div className="pc-assess-seghead">
                    <span className={`pc-assess-seglabel ${seg.label}`}>
                      {LABEL_COPY[seg.label] ?? seg.label}
                    </span>
                    <span className="pc-assess-segcover">
                      {seg.activityIds.length} of {assessment.signals.totalActivities} steps ·{' '}
                      {pct(seg.coverage)} of the process
                    </span>
                  </div>
                  <p className="pc-assess-steps">{seg.activityNames.join(' → ')}</p>
                  {written && (
                    <>
                      <p className="pc-assess-why">{written.why}</p>
                      <dl className="pc-assess-meta">
                        <dt>Before this could be pursued</dt>
                        <dd>{written.precondition}</dd>
                        <dt>Stays with a person</dt>
                        <dd>{written.staysHuman}</dd>
                      </dl>
                    </>
                  )}
                  <p className="pc-assess-cite">
                    {seg.crossesLanes && 'Crosses a hand-off · '}
                    {seg.systems.length > 0 && `${seg.systems.join(', ')} · `}
                    {seg.evidence.length > 0
                      ? `Evidence: facet ${seg.evidence.join(', ')}`
                      : 'No evidence cited'}
                  </p>
                </li>
              );
            })}
          </ol>
        </>
      )}

      {assessment.openQuestions.length > 0 && (
        <>
          <h4 className="pc-assess-h">What we could not judge</h4>
          <ul className="pc-assess-questions">
            {assessment.openQuestions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </>
      )}

      <p className="pc-assess-caveat">
        This is an indication for a decision, not a recommendation to proceed. It is derived from
        one informant&rsquo;s account of the process and is unverified — every claim above traces to
        a facet of that interview, and none of it has been reviewed. It deliberately carries no
        cost, saving or timeline, because nothing captured here would support one.
      </p>

      <button type="button" className="pc-btn ghost sm" onClick={onDownload}>
        Download the assessment
      </button>
    </section>
  );
}
