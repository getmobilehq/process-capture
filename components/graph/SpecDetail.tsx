'use client';

import { useState } from 'react';
import { ProcessMap } from './ProcessMap';
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
type Tab = 'spec' | 'map' | 'tobe';

interface ToBe {
  graph: ProcessGraph;
  xml: string;
  changedIds: Set<string>;
  changeByNode: Map<string, Change>;
  skipped: { change: Change; reason: string }[];
}

export function SpecDetail({
  sessionId,
  processName,
  informant,
  markdown,
  specVersion,
}: {
  sessionId: string;
  processName: string;
  informant: string;
  markdown: string;
  specVersion: number;
}) {
  const [tab, setTab] = useState<Tab>('spec');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<string[]>([]);
  const [map, setMap] = useState<{ graph: ProcessGraph; xml: string } | null>(null);
  const [tobe, setTobe] = useState<ToBe | null>(null);

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
      const built = { graph: data.graph as ProcessGraph, xml: data.xml as string };
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
    const base = map ?? (await drawMap());
    if (!base) return;
    setLoading(true);
    setError(null);
    setDetails([]);
    try {
      const res = await fetch(`/api/spec/${sessionId}/tobe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ graph: base.graph }),
      });
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
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The to-be map could not be built.');
    } finally {
      setLoading(false);
    }
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
        <button type="button" role="tab" className="pc-tab" disabled title="Not built yet">
          Opportunities
        </button>
      </nav>

      {tab === 'spec' && (
        <div className="pc-card" style={{ padding: 'var(--space-6)' }}>
          <p className="t-caption" style={{ marginTop: 0 }}>
            {processName} · {informant} · specification v{specVersion}
          </p>
          <pre className="pc-specbody">{markdown}</pre>
        </div>
      )}

      {tab === 'tobe' && (
        <div>
          {loading && <p className="pc-map-status">Proposing changes against the evidence…</p>}

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
          {loading && <p className="pc-map-status">Reading the specification and drawing it…</p>}

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
              <ProcessMap xml={map.xml} graph={map.graph} informant={informant} />
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
