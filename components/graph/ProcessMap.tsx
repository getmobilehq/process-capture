'use client';

import { useEffect, useRef, useState } from 'react';
import type { Annotation, Change, ProcessGraph } from '@/lib/graph/schema';

/**
 * As-is process map (delta v1.1 R5.3).
 *
 * bpmn-js in *viewer* mode — deliberately not the modeller. The graph is
 * extracted evidence, not a drawing surface; letting someone drag a box here
 * would produce a diagram that no longer matches the spec it claims to render.
 * Changes belong in the to-be change-set (R5.4), where they must cite the
 * bottleneck they resolve.
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

export function ProcessMap({
  xml,
  graph,
  informant,
  variant = 'asis',
  changedIds,
  changeByNode,
}: {
  xml: string;
  graph: ProcessGraph;
  informant: string;
  /** As-is is stated evidence; to-be is proposed and unverified until reviewed. */
  variant?: 'asis' | 'tobe';
  /** To-be only: nodes the change-set touched, styled distinctly (R5.4). */
  changedIds?: Set<string>;
  changeByNode?: Map<string, Change>;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Annotation | null>(null);
  const [change, setChange] = useState<Change | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let viewer: { destroy: () => void } | null = null;
    let cancelled = false;

    async function render() {
      if (!hostRef.current) return;
      try {
        // Loaded on demand: bpmn-js is large and only the map tab needs it.
        const { default: NavigatedViewer } = await import('bpmn-js/lib/NavigatedViewer');
        if (cancelled || !hostRef.current) return;

        const v = new NavigatedViewer({ container: hostRef.current });
        viewer = v as unknown as { destroy: () => void };

        await v.importXML(xml);
        if (cancelled) return;

        (v.get('canvas') as { zoom: (a: string, b?: string) => void }).zoom('fit-viewport', 'auto');

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
      viewer?.destroy();
    };
  }, [xml, graph, variant, changedIds, changeByNode]);

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

      <div className="pc-map-stage">
        <div ref={hostRef} className="pc-map-canvas" aria-label="Process map" />
        {!ready && !error && <p className="pc-map-status">Drawing the process map…</p>}
        {error && (
          <p className="pc-map-status error">
            The diagram could not be rendered: {error}. The specification and its export are
            unaffected.
          </p>
        )}
      </div>

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
