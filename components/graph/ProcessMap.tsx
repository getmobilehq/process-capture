'use client';

import { useEffect, useRef, useState } from 'react';
import type { Annotation, ProcessGraph } from '@/lib/graph/schema';

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
}: {
  xml: string;
  graph: ProcessGraph;
  informant: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Annotation | null>(null);
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
  }, [xml, graph]);

  return (
    <div className="pc-map">
      {/* R5.3 — provenance is stated on the diagram, not left to be inferred. */}
      <div className="pc-map-banner asis">
        <b>As-is — stated</b>
        <span>from the interview of {informant}</span>
      </div>

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
