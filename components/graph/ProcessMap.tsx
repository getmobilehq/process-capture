'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Annotation, Change, ProcessGraph } from '@/lib/graph/schema';

/**
 * As-is process map (delta v1.1 R5.3).
 *
 * The canvas is editable when `editable` is set (R5.6). This reverses an earlier
 * decision to ship viewer-only, and the reason that decision existed still holds:
 * the graph is extracted evidence, not a drawing surface. The reconciliation is
 * that **editing changes the drawing, not the evidence** — the adjusted BPMN is
 * stored beside the graph, never instead of it, and "reset to generated" restores
 * the algorithm's layout exactly. A generated layout is a starting point; a long
 * process laid out left to right is wide and awkward, and the architect reading it
 * knows better than the algorithm where things should sit.
 *
 * Semantic change still belongs in the to-be change-set (R5.4), where it must cite
 * the bottleneck it resolves. Moving a box is not a change to what was said.
 *
 * Annotations render as overlay badges on their target element rather than as
 * BPMN text annotations, so clicking one can open the evidence panel with its
 * facet citation — the diagram stays readable and the evidence stays one tap away.
 */
const KIND_LABEL: Record<Annotation['kind'], string> = {
  bottleneck: 'Bottleneck',
  risk: 'Risk',
  metric: 'Metric',
};

/** Short, colour-independent marks — a badge must read without colour (R5.5). */
const OPP_MARK: Record<string, string> = {
  automatable: 'A',
  assistable: '\u00BD',
  'human-required': 'H',
  unclassified: '?',
};

export function ProcessMap({
  xml,
  graph,
  informant,
  variant = 'asis',
  changedIds,
  changeByNode,
  opportunities,
  editable = false,
  adjusted = false,
  sessionId,
}: {
  xml: string;
  graph: ProcessGraph;
  informant: string;
  /** As-is is stated evidence; to-be is proposed and unverified until reviewed. */
  variant?: 'asis' | 'tobe';
  /** To-be only: nodes the change-set touched, styled distinctly (R5.4). */
  changedIds?: Set<string>;
  changeByNode?: Map<string, Change>;
  /** As-is only: automation labels per activity, toggled on (R5.5). */
  opportunities?: Map<string, { label: string; rationale: string; evidence: number[] }>;
  /** Let the architect rearrange the drawing and keep it (R5.6). */
  editable?: boolean;
  /** True when what is being shown is already an adjusted drawing, not generated. */
  adjusted?: boolean;
  /** Required when editable — where to save the arrangement. */
  sessionId?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<{ get: (n: string) => unknown } | null>(null);
  const [full, setFull] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Annotation | null>(null);
  const [change, setChange] = useState<Change | null>(null);
  const [opp, setOpp] = useState<
    { id: string; label: string; rationale: string; evidence: number[] } | null
  >(null);
  const [ready, setReady] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  useEffect(() => {
    let viewer: { destroy: () => void } | null = null;
    let cancelled = false;

    async function render() {
      if (!hostRef.current) return;
      try {
        // Loaded on demand: bpmn-js is large and only the map tab needs it. The
        // modeller is larger still, so it is only pulled in when editing is on.
        const { default: Engine } = editable
          ? await import('bpmn-js/lib/Modeler')
          : await import('bpmn-js/lib/NavigatedViewer');
        if (cancelled || !hostRef.current) return;

        const v = new Engine({ container: hostRef.current });
        viewer = v as unknown as { destroy: () => void };
        viewerRef.current = v as unknown as { get: (n: string) => unknown };

        await v.importXML(xml);
        if (cancelled) return;

        (v.get('canvas') as { zoom: (a: string, b?: string) => void }).zoom('fit-viewport', 'auto');

        if (editable) {
          (v.get('eventBus') as { on: (e: string, cb: () => void) => void }).on(
            'commandStack.changed',
            () => setDirty(true),
          );
        }

        // Badges hang off their target element, so they travel with pan and zoom.
        const overlays = v.get('overlays') as {
          add: (id: string, o: unknown) => void;
        };
        const registry = v.get('elementRegistry') as { get: (id: string) => unknown };
        const canvas = v.get('canvas') as { addMarker: (id: string, cls: string) => void };

        // R5.4 / Appendix A point 3 — a reader must be able to tell changed from
        // unchanged without reading labels, so changed elements are marked for
        // dashed styling and carry a badge naming the bottleneck they resolve.
        if (variant === 'tobe' && changedIds) {
          for (const id of changedIds) {
            const safe = id.replace(/[^A-Za-z0-9_.-]/g, '_');
            if (!registry.get(safe)) continue;
            canvas.addMarker(safe, 'pc-changed');

            const change = changeByNode?.get(id);
            if (!change) continue;
            const badge = document.createElement('button');
            badge.type = 'button';
            badge.className = 'pc-badge change';
            badge.textContent = '\u2726';
            badge.title = `Proposed change — resolves ${change.resolvesAnnotationId.join(', ')}`;
            badge.addEventListener('click', (e) => {
              e.stopPropagation();
              setChange(change);
            });
            overlays.add(safe, { position: { top: -12, left: -12 }, html: badge });
          }
        }

        // R5.5 — automation labels as lane-safe badges on the activity itself,
        // so the reading stays attached to the step it judges.
        if (opportunities && opportunities.size > 0) {
          for (const [id, o] of opportunities) {
            const safe = id.replace(/[^A-Za-z0-9_.-]/g, '_');
            if (!registry.get(safe)) continue;
            const badge = document.createElement('button');
            badge.type = 'button';
            badge.className = `pc-oppbadge ${o.label}`;
            badge.textContent = OPP_MARK[o.label] ?? '?';
            badge.title = `${o.label} — click for the evidence`;
            badge.addEventListener('click', (e) => {
              e.stopPropagation();
              setOpp({ id, ...o });
            });
            overlays.add(safe, { position: { bottom: -10, left: 10 }, html: badge });
          }
        }

        for (const a of graph.annotations) {
          const targetId = a.targetId.replace(/[^A-Za-z0-9_.-]/g, '_');
          if (!registry.get(targetId)) continue;
          const badge = document.createElement('button');
          badge.type = 'button';
          badge.className = `pc-badge ${a.kind}`;
          badge.textContent = a.kind === 'bottleneck' ? '!' : a.kind === 'risk' ? '△' : '#';
          badge.title = `${KIND_LABEL[a.kind]} — click for the evidence`;
          badge.addEventListener('click', (e) => {
            e.stopPropagation();
            setSelected(a);
          });
          overlays.add(targetId, { position: { top: -12, right: 12 }, html: badge });
        }

        setReady(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'The diagram could not be rendered.');
      }
    }

    void render();
    return () => {
      cancelled = true;
      viewerRef.current = null;
      viewer?.destroy();
    };
  }, [xml, graph, variant, changedIds, changeByNode, opportunities, editable]);

  function canvas() {
    return viewerRef.current?.get('canvas') as
      | { zoom: (a: string | number, b?: string) => void; viewbox: () => { scale: number } }
      | undefined;
  }

  async function saveLayout() {
    const v = viewerRef.current as unknown as
      | { saveXML: (o: { format: boolean }) => Promise<{ xml?: string }> }
      | null;
    if (!v || !sessionId) return;
    setSaving(true);
    try {
      const { xml: out } = await v.saveXML({ format: true });
      const res = await fetch(`/api/spec/${sessionId}/graph/layout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: variant, diagramXml: out ?? null }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Save failed.');
      setDirty(false);
      setSavedNote('Arrangement saved.');
    } catch (err) {
      setSavedNote(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  /** Clear the stored arrangement; the next draw returns the generated layout. */
  async function resetLayout() {
    if (!sessionId) return;
    setSaving(true);
    try {
      await fetch(`/api/spec/${sessionId}/graph/layout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: variant, diagramXml: null }),
      });
      setSavedNote('Reset. Reload to see the generated layout.');
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }

  function download(name: string, data: string, mime: string) {
    const url = URL.createObjectURL(new Blob([data], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Export, so taking the diagram to a modelling tool is a choice rather than
   * something forced by our own canvas being inadequate. BPMN 2.0 XML opens in
   * ARIS, Camunda, Signavio and bpmn.io; SVG goes into a slide.
   */
  async function exportAs(kind: 'bpmn' | 'svg') {
    const v = viewerRef.current as unknown as {
      saveXML: (o: { format: boolean }) => Promise<{ xml?: string }>;
      saveSVG: () => Promise<{ svg?: string }>;
    } | null;
    if (!v) return;
    const base = `process-map-${variant}`;
    if (kind === 'bpmn') {
      const { xml: out } = await v.saveXML({ format: true });
      if (out) download(`${base}.bpmn`, out, 'application/xml');
    } else {
      const { svg } = await v.saveSVG();
      if (svg) download(`${base}.svg`, svg, 'image/svg+xml');
    }
  }

  function zoom(direction: 1 | -1) {
    const c = canvas();
    if (!c) return;
    c.zoom(Math.max(0.2, Math.min(4, c.viewbox().scale * (direction === 1 ? 1.25 : 0.8))));
  }

  const fit = useCallback(() => {
    (
      viewerRef.current?.get('canvas') as { zoom: (a: string, b?: string) => void } | undefined
    )?.zoom('fit-viewport', 'auto');
  }, []);

  /**
   * Full screen on the stage, not the whole page: the diagram is the thing worth
   * the room. Refits after the transition so the new viewport is actually used —
   * otherwise the diagram sits tiny in the middle of a large black rectangle.
   */
  async function toggleFull() {
    const el = stageRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await el.requestFullscreen();
      }
    } catch {
      // Fullscreen can be refused (permissions policy, embedded contexts). Fall
      // back to an in-page expansion so the control always does something.
      setFull((f) => !f);
      setTimeout(fit, 60);
    }
  }

  useEffect(() => {
    function onChange() {
      setFull(Boolean(document.fullscreenElement));
      setTimeout(fit, 60);
    }
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [fit]);

  return (
    <div className="pc-map">
      {/* Provenance is stated on the diagram, not left to be inferred (R5.3/R5.4). */}
      {variant === 'asis' ? (
        <div className="pc-map-banner asis">
          <b>As-is — stated</b>
          <span>from the interview of {informant}</span>
        </div>
      ) : (
        <div className="pc-map-banner tobe">
          <b>To-be — proposed, machine-generated, unverified</b>
          <span>dashed elements are proposed changes · not for handover until reviewed</span>
        </div>
      )}

      {variant === 'tobe' && (
        <div className="pc-map-legend">
          <span>
            <i className="pc-legend-key" aria-hidden="true" /> unchanged — as stated
          </span>
          <span>
            <i className="pc-legend-key changed" aria-hidden="true" /> proposed change — unverified
          </span>
        </div>
      )}

      <div ref={stageRef} className={`pc-map-stage ${full ? 'full' : ''}`}>
        <div className="pc-map-controls">
          <button type="button" className="pc-mapbtn" onClick={() => zoom(1)} title="Zoom in">
            +
          </button>
          <button type="button" className="pc-mapbtn" onClick={() => zoom(-1)} title="Zoom out">
            −
          </button>
          <button type="button" className="pc-mapbtn" onClick={fit} title="Fit to view">
            Fit
          </button>
          <button type="button" className="pc-mapbtn wide" onClick={toggleFull}>
            {full ? 'Exit full screen' : 'Full screen'}
          </button>
          <span className="pc-map-sep" aria-hidden="true" />
          <button
            type="button"
            className="pc-mapbtn wide"
            onClick={() => void exportAs('bpmn')}
            title="BPMN 2.0 — opens in ARIS, Camunda, Signavio, bpmn.io"
          >
            .bpmn
          </button>
          <button
            type="button"
            className="pc-mapbtn wide"
            onClick={() => void exportAs('svg')}
            title="Vector image for a document or slide"
          >
            .svg
          </button>
          {editable && sessionId && (
            <>
              <span className="pc-map-sep" aria-hidden="true" />
              <button
                type="button"
                className="pc-mapbtn wide primary"
                onClick={() => void saveLayout()}
                disabled={!dirty || saving}
                title="Keep this arrangement for everyone who opens the map"
              >
                {saving ? 'Saving…' : dirty ? 'Save arrangement' : 'Saved'}
              </button>
              {adjusted && (
                <button
                  type="button"
                  className="pc-mapbtn wide"
                  onClick={() => void resetLayout()}
                  disabled={saving}
                  title="Discard the arrangement and go back to the generated layout"
                >
                  Reset
                </button>
              )}
            </>
          )}
        </div>
        {editable && (
          <p className="pc-map-editnote">
            {savedNote ??
              'Drag to rearrange. Saving keeps the drawing only — it does not change the specification or the evidence behind it.'}
          </p>
        )}
        <div ref={hostRef} className="pc-map-canvas" aria-label="Process map" />
        {!ready && !error && <p className="pc-map-status">Drawing the process map…</p>}
        {error && (
          <p className="pc-map-status error">
            The diagram could not be rendered: {error}. The specification and its export are
            unaffected.
          </p>
        )}
      </div>

      {opp && (
        <aside className="pc-evidence" role="region" aria-label="Automation potential">
          <div className="pc-evidence-head">
            <span className={`pc-evidence-kind opp-${opp.label}`}>{opp.label}</span>
            <button type="button" className="pc-check-na" onClick={() => setOpp(null)}>
              Close
            </button>
          </div>
          <p className="pc-evidence-text">{opp.rationale}</p>
          <p className="pc-evidence-cite">
            {opp.evidence.length > 0
              ? `Evidence: facet ${opp.evidence.join(', ')}`
              : 'No facet evidence — this is why it is unclassified.'}{' '}
            · proposed, unverified
          </p>
        </aside>
      )}

      {change && (
        <aside className="pc-evidence" role="region" aria-label="Proposed change">
          <div className="pc-evidence-head">
            <span className="pc-evidence-kind change">Proposed change</span>
            <button type="button" className="pc-check-na" onClick={() => setChange(null)}>
              Close
            </button>
          </div>
          <p className="pc-evidence-text">{change.description}</p>
          <p className="pc-evidence-cite">
            Resolves {change.resolvesAnnotationId.join(', ')} ·{' '}
            {graph.annotations
              .filter((a) => change.resolvesAnnotationId.includes(a.id))
              .map((a) => a.text)
              .join('; ') || 'bottleneck from the as-is map'}
          </p>
          <p className="pc-evidence-cite">{change.rationale}</p>
        </aside>
      )}

      {selected && (
        <aside className="pc-evidence" role="region" aria-label="Evidence">
          <div className="pc-evidence-head">
            <span className={`pc-evidence-kind ${selected.kind}`}>{KIND_LABEL[selected.kind]}</span>
            <button type="button" className="pc-check-na" onClick={() => setSelected(null)}>
              Close
            </button>
          </div>
          <p className="pc-evidence-text">{selected.text}</p>
          {selected.evidence.quote && (
            <blockquote className="pc-evidence-quote">“{selected.evidence.quote}”</blockquote>
          )}
          <p className="pc-evidence-cite">
            Facet {selected.evidence.facet} · stated by {informant}
          </p>
        </aside>
      )}
    </div>
  );
}
