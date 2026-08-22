'use client';

import { LEVEL_META, type AutonomyLevel, type AutonomySummary } from '@/lib/graph/autonomy-levels';

/**
 * The autonomy report (R5.9).
 *
 * A printable page rather than a screen feature. The swimlane is served as SVG so
 * it prints at any size without rasterising, and "Save as PDF" is the browser's
 * own print dialogue — no PDF library, so P6 holds, and the output is a real
 * vector PDF rather than a screenshot in a wrapper.
 */
const ORDER: AutonomyLevel[] = ['L3', 'L2', 'L1', 'L0', 'unassessed'];

export interface AutonomyView {
  autonomy: {
    levels: { activityId: string; level: AutonomyLevel; evidence: number[]; rationale: string; toAdvance: string }[];
  };
  summary: AutonomySummary;
  svg: string;
  activities: { id: string; name: string; laneId: string }[];
  lanes: { id: string; name: string }[];
  processName: string;
  informant: string;
}

export function AutonomyReport({ view }: { view: AutonomyView }) {
  const { summary } = view;
  const nameOf = new Map(view.activities.map((a) => [a.id, a.name]));
  const laneOf = new Map(view.activities.map((a) => [a.id, a.laneId]));
  const laneName = new Map(view.lanes.map((l) => [l.id, l.name]));
  const pct = (n: number) => (summary.total === 0 ? 0 : Math.round((n / summary.total) * 100));

  function download() {
    const blob = new Blob([view.svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `autonomy-${view.processName.replace(/\W+/g, '-').toLowerCase()}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="pc-auto" aria-label="Autonomy assessment">
      <div className="pc-auto-actions">
        <button type="button" className="pc-btn" onClick={() => window.print()}>
          Save as PDF
        </button>
        <button type="button" className="pc-btn ghost sm" onClick={download}>
          Download the swimlane (.svg)
        </button>
        <span className="t-caption" style={{ color: 'var(--fg-muted)' }}>
          “Save as PDF” opens your print dialogue — choose PDF as the destination.
        </span>
      </div>

      <div className="pc-auto-figures">
        {ORDER.filter((l) => summary.counts[l] > 0).map((l) => (
          <span key={l} className="pc-auto-fig" style={{ borderColor: LEVEL_META[l].border }}>
            <b style={{ color: LEVEL_META[l].ink }}>{summary.counts[l]}</b>
            <i>
              {LEVEL_META[l].title === '?' ? 'not assessed' : LEVEL_META[l].title} ·{' '}
              {pct(summary.counts[l])}%
            </i>
          </span>
        ))}
      </div>

      <p className="pc-auto-lead">
        Of {summary.total} steps, <b>{summary.systemCanDo}</b> could be carried out by a system
        with a person verifying or not involved at all ({pct(summary.systemCanDo)}%).
        {summary.counts.L0 > 0 && (
          <>
            {' '}
            <b>{summary.counts.L0}</b> should stay human — by nature or by design.
          </>
        )}
        {summary.counts.unassessed > 0 && (
          <>
            {' '}
            <b>{summary.counts.unassessed}</b> could not be placed from what was captured.
          </>
        )}
      </p>

      {/* The swimlane. Server-rendered SVG, inlined so it prints with the page. */}
      <div className="pc-auto-swim" dangerouslySetInnerHTML={{ __html: view.svg }} />

      <h3 className="pc-auto-h">By team</h3>
      <table className="pc-auto-table">
        <thead>
          <tr>
            <th>Team</th>
            {ORDER.map((l) => (
              <th key={l}>{LEVEL_META[l].title === '?' ? 'n/a' : LEVEL_META[l].title}</th>
            ))}
            <th>Steps</th>
          </tr>
        </thead>
        <tbody>
          {summary.byLane.map((lane) => (
            <tr key={lane.laneId}>
              <td>{lane.laneName}</td>
              {ORDER.map((l) => (
                <td key={l} style={{ color: lane.counts[l] ? LEVEL_META[l].ink : 'var(--ink-300)' }}>
                  {lane.counts[l] || '—'}
                </td>
              ))}
              <td>
                <b>{lane.total}</b>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 className="pc-auto-h">Step by step</h3>
      <ol className="pc-auto-steps">
        {view.autonomy.levels.map((l) => {
          const meta = LEVEL_META[l.level];
          return (
            <li key={l.activityId} style={{ borderLeftColor: meta.border }}>
              <div className="pc-auto-stephead">
                <span className="pc-auto-level" style={{ background: meta.fill, color: meta.ink }}>
                  {meta.title === '?' ? 'Not assessed' : meta.title}
                </span>
                <b>{nameOf.get(l.activityId) ?? l.activityId}</b>
                <i>{laneName.get(laneOf.get(l.activityId) ?? '') ?? ''}</i>
              </div>
              <p className="pc-auto-why">{l.rationale}</p>
              {l.toAdvance && l.level !== 'L3' && (
                <p className="pc-auto-adv">
                  <span>To go further</span> {l.toAdvance}
                </p>
              )}
              <p className="pc-auto-cite">
                {l.evidence.length > 0 ? `Evidence: facet ${l.evidence.join(', ')}` : 'No evidence cited'}
              </p>
            </li>
          );
        })}
      </ol>

      <p className="pc-auto-caveat">
        This is an assessment of what the specification describes, not a plan. Every level above is
        proposed and unverified, derived from one informant&rsquo;s account of their own work, and
        each one traces to a facet of that interview. It carries no cost, saving or timeline,
        because nothing captured would support one. L0 is a legitimate destination — some work
        should stay human, and the scale says so rather than treating it as a gap.
      </p>
    </section>
  );
}
