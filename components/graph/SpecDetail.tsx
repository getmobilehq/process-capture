'use client';

import { useState } from 'react';
import { ProcessMap } from './ProcessMap';
import { AutomationAssessment } from './AutomationAssessment';
import { AutonomyReport, type AutonomyView } from './AutonomyReport';
import { SpecView } from './SpecView';
import { ChangeReview, type ReviewState } from './ChangeReview';
import type { Change, ProcessGraph } from '@/lib/graph/schema';

/**
 * Spec detail with a Process map tab (delta v1.1 R5.6, partial).
 *
 * The map is drawn on request rather than on load: extraction is a live model
 * call, so opening a spec should not silently spend one. The BPMN download is
 * named explicitly as the ARIS path (R5.2) so nobody has to guess what it is.
 *
 * To-be and Opportunities are declared but not built — showing the tabs disabled
 * is more honest than hiding them, since the delta specifies all three sub-views.
 */
type Tab = 'spec' | 'map' | 'tobe' | 'opps' | 'assess' | 'levels';

interface ToBe {
  graph: ProcessGraph;
  xml: string;
  changedIds: Set<string>;
  changeByNode: Map<string, Change>;
  skipped: { change: Change; reason: string }[];
  /** R5.4 — who has ruled on what, and whether this may be shared yet. */
  review: ReviewState;
  blocked: string | null;
}

export function SpecDetail({
  sessionId,
  processName,
  informant,
  markdown,
  specVersion,
  toBeEnabled,
}: {
  sessionId: string;
  processName: string;
  informant: string;
  markdown: string;
  specVersion: number;
  /** R5.4's verification gate is unbuilt, so to-be is off unless enabled. */
  toBeEnabled: boolean;
}) {
  const [tab, setTab] = useState<Tab>('spec');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<string[]>([]);
  const [map, setMap] = useState<{ graph: ProcessGraph; xml: string; adjusted?: boolean } | null>(null);
  const [tobe, setTobe] = useState<ToBe | null>(null);
  const [assess, setAssess] = useState<{ assessment: never; processName: string } | null>(null);
  const [levels, setLevels] = useState<AutonomyView | null>(null);
  const [opps, setOpps] = useState<{
    opportunities: { classifications: { activityId: string; label: string; rationale: string; evidence: number[] }[] };
    summary: { automatable: number; assistable: number; humanRequired: number; unclassified: number; total: number };
    activities: { id: string; name: string }[];
    review: ReviewState;
    blocked: string | null;
  } | null>(null);

  /** Returns the map as well as storing it — React state is stale to callers. */
  async function drawMap(): Promise<{ graph: ProcessGraph; xml: string } | null> {
    if (map) return map;
    if (loading) return null;
    setLoading(true);
    setError(null);
    setDetails([]);
    try {
      const res = await fetch(`/api/spec/${sessionId}/graph`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDetails(Array.isArray(data.details) ? data.details : []);
        throw new Error(data.error ?? 'The process map could not be built.');
      }
      const built = {
        graph: data.graph as ProcessGraph,
        xml: data.xml as string,
        adjusted: Boolean(data.adjusted),
      };
      setMap(built);
      return built;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The process map could not be built.');
    } finally {
      setLoading(false);
    }
    return null;
  }

  /** To-be needs the as-is map first — changes are proposed against that graph. */
  async function drawToBe() {
    if (tobe || loading) return;
    // The as-is must exist first: the server proposes changes against the stored
    // graph, so drawing it is what puts it there.
    if (!(map ?? (await drawMap()))) return;
    setLoading(true);
    setError(null);
    setDetails([]);
    try {
      const res = await fetch(`/api/spec/${sessionId}/tobe`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDetails(Array.isArray(data.details) ? data.details : []);
        throw new Error(data.error ?? 'The to-be map could not be built.');
      }
      setTobe({
        graph: data.graph,
        xml: data.xml,
        changedIds: new Set<string>(data.changedIds ?? []),
        changeByNode: new Map<string, Change>(data.changes ?? []),
        skipped: data.skipped ?? [],
        review: data.review,
        blocked: data.blocked ?? null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The to-be map could not be built.');
    } finally {
      setLoading(false);
    }
  }

  /** The rendered view is for reading; the .md remains the artefact to hand on. */
  function downloadMarkdown() {
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `spec-${processName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-v${specVersion}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /** Record one verdict. The server returns the whole state, so nothing drifts. */
  async function reviewChange(
    index: number,
    verdict: 'approved' | 'edited' | 'rejected',
    extra: { editedDescription?: string; note?: string } = {},
    subject: 'change' | 'opportunity' = 'change',
  ) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/spec/${sessionId}/tobe/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ changeIndex: index, verdict, subject, ...extra }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? 'Could not record that review.');
      if (subject === 'opportunity') {
        setOpps((prev) => (prev ? { ...prev, review: data.state, blocked: data.state?.verified ? null : prev.blocked } : prev));
      } else {
        setTobe((prev) =>
          prev ? { ...prev, review: data.state, blocked: data.state?.verified ? null : prev.blocked } : prev,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record that review.');
    } finally {
      setLoading(false);
    }
  }

  /**
   * The to-be export is gated (R5.4): unreviewed proposals must not leave the
   * console. The button is disabled *and* this refuses, because a disabled
   * control is a hint and a gate has to be a rule.
   */
  /** Labels attach to the as-is activities, so that map must exist first. */
  async function drawOpps() {
    if (opps || loading) return;
    if (!(map ?? (await drawMap()))) return;
    setLoading(true);
    setError(null);
    setDetails([]);
    try {
      const res = await fetch(`/api/spec/${sessionId}/opportunities`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDetails(Array.isArray(data.details) ? data.details : []);
        throw new Error(data.error ?? 'The opportunity overlay could not be built.');
      }
      setOpps(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The opportunity overlay could not be built.');
    } finally {
      setLoading(false);
    }
  }

  /** Built on the opportunity labels, so those have to exist first. */
  async function runAssessment() {
    if (assess || loading) return;
    if (!opps && !(await (async () => { await drawOpps(); return true; })())) return;
    setLoading(true);
    setError(null);
    setDetails([]);
    try {
      const res = await fetch(`/api/spec/${sessionId}/assessment`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDetails(Array.isArray(data.details) ? data.details : []);
        throw new Error(data.error ?? 'The assessment could not be produced.');
      }
      setAssess(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The assessment could not be produced.');
    } finally {
      setLoading(false);
    }
  }

  /** Levels attach to the as-is steps, so that map must exist first. */
  async function runLevels() {
    if (levels || loading) return;
    if (!(map ?? (await drawMap()))) return;
    setLoading(true);
    setError(null);
    setDetails([]);
    try {
      const res = await fetch(`/api/spec/${sessionId}/autonomy`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDetails(Array.isArray(data.details) ? data.details : []);
        throw new Error(data.error ?? 'The autonomy assessment could not be produced.');
      }
      setLevels(data as AutonomyView);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The autonomy assessment could not be produced.');
    } finally {
      setLoading(false);
    }
  }

  function downloadAssessment() {
    if (!assess) return;
    const a = assess.assessment as unknown as {
      verdict: string; headline: string; reasoning: string;
      segments: { segmentId: string; why: string; precondition: string; staysHuman: string }[];
      openQuestions: string[];
      derived: { id: string; label: string; activityNames: string[]; coverage: number; evidence: number[] }[];
      signals: { totalActivities: number; automationShare: number; unclassifiedShare: number };
    };
    const pct = (n: number) => `${Math.round(n * 100)}%`;
    const written = new Map(a.segments.map((x) => [x.segmentId, x]));
    const lines = [
      `# Automation assessment — ${assess.processName}`,
      '',
      `**Verdict: ${a.verdict}**`,
      '',
      a.headline,
      '',
      a.reasoning,
      '',
      `- ${a.signals.totalActivities} steps assessed`,
      `- ${pct(a.signals.automationShare)} automatable or assistable`,
      `- ${pct(a.signals.unclassifiedShare)} not judged`,
      '',
      '## Where the opportunity is',
      '',
    ];
    for (const seg of a.derived.filter((d) => d.label === 'automatable' || d.label === 'assistable')) {
      const w = written.get(seg.id);
      lines.push(`### ${seg.label} — ${pct(seg.coverage)} of the process`);
      lines.push('');
      lines.push(seg.activityNames.join(' → '));
      if (w) {
        lines.push('', w.why, '', `**Before this could be pursued:** ${w.precondition}`, '', `**Stays with a person:** ${w.staysHuman}`);
      }
      lines.push('', `Evidence: facet ${seg.evidence.join(', ') || 'none cited'}`, '');
    }
    if (a.openQuestions.length > 0) {
      lines.push('## What we could not judge', '');
      for (const q of a.openQuestions) lines.push(`- ${q}`);
      lines.push('');
    }
    lines.push(
      '---',
      '',
      'This is an indication for a decision, not a recommendation to proceed. It is derived from one informant\'s account and is unverified. It carries no cost, saving or timeline, because nothing captured would support one.',
    );
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const el = document.createElement('a');
    el.href = url;
    el.download = `automation-assessment-${sessionId}.md`;
    el.click();
    URL.revokeObjectURL(url);
  }

  function downloadToBe() {
    if (!tobe || !tobe.review.verified) return;
    const blob = new Blob([tobe.xml], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${tobe.graph.processId}-to-be-reviewed.bpmn`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function download() {
    if (!map) return;
    const blob = new Blob([map.xml], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${map.graph.processId}.bpmn`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <nav className="pc-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'spec'}
          className={`pc-tab ${tab === 'spec' ? 'active' : ''}`}
          onClick={() => setTab('spec')}
        >
          Specification
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'map'}
          className={`pc-tab ${tab === 'map' ? 'active' : ''}`}
          onClick={() => {
            setTab('map');
            void drawMap();
          }}
        >
          Process map
        </button>
        {toBeEnabled ? (
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'tobe'}
            className={`pc-tab ${tab === 'tobe' ? 'active' : ''}`}
            onClick={() => {
              setTab('tobe');
              void drawToBe();
            }}
          >
            To-be
          </button>
        ) : (
          <button
            type="button"
            role="tab"
            className="pc-tab"
            disabled
            title="Not available until each proposed change can be reviewed and approved"
          >
            To-be
          </button>
        )}
        {toBeEnabled ? (
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'opps'}
            className={`pc-tab ${tab === 'opps' ? 'active' : ''}`}
            onClick={() => {
              setTab('opps');
              void drawOpps();
            }}
          >
            Opportunities
          </button>
        ) : (
          <button
            type="button"
            role="tab"
            className="pc-tab"
            disabled
            title="Not available until each label can be reviewed and approved"
          >
            Opportunities
          </button>
        )}
        {toBeEnabled && (
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'assess'}
            className={`pc-tab ${tab === 'assess' ? 'active' : ''}`}
            onClick={() => {
              setTab('assess');
              void runAssessment();
            }}
            title="Would this process benefit from AI automation?"
          >
            Automation assessment
          </button>
        )}
        {toBeEnabled && (
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'levels'}
            className={`pc-tab ${tab === 'levels' ? 'active' : ''}`}
            onClick={() => {
              setTab('levels');
              void runLevels();
            }}
            title="How far each step could run without a person"
          >
            Autonomy levels
          </button>
        )}
      </nav>

      {tab === 'spec' && (
        <div>
          <div className="pc-card" style={{ padding: 'var(--space-6)' }}>
            <SpecView markdown={markdown} />
          </div>
          <div style={{ marginTop: 'var(--space-4)' }}>
            <button type="button" className="pc-btn ghost sm" onClick={downloadMarkdown}>
              Download specification (.md)
            </button>
          </div>
        </div>
      )}

      {tab === 'opps' && (
        <div>
          {loading && <p className="pc-map-status">Reading the evidence for each activity… this takes a minute or two on a long process.</p>}
          {error && (
            <div className="pc-card" style={{ padding: 'var(--space-6)' }}>
              <p style={{ marginTop: 0, color: 'var(--vm-red)', fontWeight: 700 }}>{error}</p>
              {details.length > 0 && (
                <ul className="t-body-s">
                  {details.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {opps && map && (
            <>
              <div className="pc-map-banner tobe">
                <b>Automation potential — proposed, unverified</b>
                <span>a claim about how work could change · not for handover until reviewed</span>
              </div>
              <div className="pc-opp-summary">
                <span><b>{opps.summary.automatable}</b> automatable</span>
                <span><b>{opps.summary.assistable}</b> assistable</span>
                <span><b>{opps.summary.humanRequired}</b> human-required</span>
                <span><b>{opps.summary.unclassified}</b> unclassified</span>
              </div>
              <ProcessMap
                xml={map.xml}
                graph={map.graph}
                informant={informant}
                opportunities={
                  new Map(
                    opps.opportunities.classifications.map((c) => [
                      c.activityId,
                      { label: c.label, rationale: c.rationale, evidence: c.evidence },
                    ]),
                  )
                }
              />
              <ChangeReview
                state={opps.review}
                blocked={opps.blocked}
                busy={loading}
                onReview={(i, v, extra) => void reviewChange(i, v, extra, 'opportunity')}
              />
            </>
          )}
        </div>
      )}

      {tab === 'levels' && (
        <div>
          {loading && <p className="pc-map-status">Placing each step on the scale… this takes a minute or two on a long process.</p>}
          {error && (
            <div className="pc-card" style={{ padding: 'var(--space-6)' }}>
              <p style={{ marginTop: 0, color: 'var(--vm-red)', fontWeight: 700 }}>{error}</p>
              {details.length > 0 && (
                <ul className="t-body-s">
                  {details.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {levels && <AutonomyReport view={levels} />}
        </div>
      )}

      {tab === 'assess' && (
        <div>
          {loading && <p className="pc-map-status">Weighing the evidence for each step… this takes a minute or two on a long process.</p>}
          {error && (
            <div className="pc-card" style={{ padding: 'var(--space-6)' }}>
              <p style={{ marginTop: 0, color: 'var(--vm-red)', fontWeight: 700 }}>{error}</p>
              {details.length > 0 && (
                <ul className="t-body-s">
                  {details.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {assess && (
            <AutomationAssessment
              assessment={assess.assessment}
              processName={assess.processName}
              onDownload={downloadAssessment}
            />
          )}
        </div>
      )}

      {tab === 'tobe' && (
        <div>
          {loading && <p className="pc-map-status">Proposing changes against the evidence… this takes a minute or two on a long process.</p>}

          {error && (
            <div className="pc-card" style={{ padding: 'var(--space-6)' }}>
              <p style={{ marginTop: 0, color: 'var(--vm-red)', fontWeight: 700 }}>{error}</p>
              {details.length > 0 && (
                <ul className="t-body-s">
                  {details.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {tobe && (
            <>
              <ProcessMap
                xml={tobe.xml}
                graph={tobe.graph}
                informant={informant}
                variant="tobe"
                changedIds={tobe.changedIds}
                changeByNode={tobe.changeByNode}
              />
              {tobe.changedIds.size === 0 && (
                <p className="t-body-s" style={{ marginTop: 'var(--space-3)' }}>
                  No changes were proposed — the as-is map carries no evidenced bottlenecks to
                  resolve.
                </p>
              )}
              {tobe.review.verified ? (
                <div style={{ marginTop: 'var(--space-4)' }}>
                  <button type="button" className="pc-btn ghost sm" onClick={downloadToBe}>
                    Export to-be BPMN 2.0 (reviewed)
                  </button>
                </div>
              ) : (
                <div style={{ marginTop: 'var(--space-4)' }}>
                  <button type="button" className="pc-btn ghost sm" disabled title={tobe.blocked ?? ''}>
                    Export to-be BPMN 2.0
                  </button>
                  <p className="t-body-s" style={{ marginTop: 6, color: 'var(--ink-500)' }}>
                    Available once every proposed change has been reviewed.
                  </p>
                </div>
              )}

              <ChangeReview
                state={tobe.review}
                blocked={tobe.blocked}
                busy={loading}
                onReview={(i, v, extra) => void reviewChange(i, v, extra)}
              />

              {tobe.skipped.length > 0 && (
                <div className="pc-card" style={{ padding: 'var(--space-5)', marginTop: 'var(--space-4)' }}>
                  <p className="t-caption" style={{ marginTop: 0 }}>
                    Proposed but not placed on the diagram:
                  </p>
                  <ul className="t-body-s">
                    {tobe.skipped.map((s) => (
                      <li key={s.change.target}>
                        {s.change.description} — {s.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {tab === 'map' && (
        <div>
          {loading && <p className="pc-map-status">Reading the specification and drawing it… this takes a minute or two on a long process.</p>}

          {error && (
            <div className="pc-card" style={{ padding: 'var(--space-6)' }}>
              <p style={{ marginTop: 0, color: 'var(--vm-red)', fontWeight: 700 }}>{error}</p>
              {details.length > 0 && (
                <>
                  <p className="t-caption">The graph failed validation on:</p>
                  <ul className="t-body-s">
                    {details.map((d) => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>
                </>
              )}
              <p className="t-body-s">
                The specification itself is unaffected and can still be downloaded.
              </p>
            </div>
          )}

          {map && (
            <>
              <ProcessMap
                xml={map.xml}
                graph={map.graph}
                informant={informant}
                editable
                adjusted={map.adjusted}
                sessionId={sessionId}
              />
              <div style={{ marginTop: 'var(--space-4)' }}>
                <button type="button" className="pc-btn ghost sm" onClick={download}>
                  Export BPMN 2.0 (ARIS-compatible)
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
