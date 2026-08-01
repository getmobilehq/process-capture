'use client';

import { useState } from 'react';
import { FACETS } from '@/lib/facets/facets';
import { isTerminal, type CoverageStateValue, type ElementStateValue } from '@/lib/engine/coverage';

interface CoverageRow {
  facetId: number;
  state: CoverageStateValue;
}

export interface ElementRow {
  facetId: number;
  elementId: string;
  state: ElementStateValue;
  summary: string;
  naReason: string;
}

const STATE_LABEL: Record<CoverageStateValue, string> = {
  pending: '',
  partial: 'in progress',
  answered: 'answered',
  unknown_to_informant: 'not known',
  not_applicable: 'n/a',
};

const MARK: Record<ElementStateValue, string> = {
  captured: '✓',
  not_applicable: '–',
  outstanding: '○',
};

/**
 * The 12-facet coverage rail (FR-3.5), now checklist-driven (delta v1.1 R1.1).
 *
 * Expanding a facet shows its elements: what was captured (with a one-line
 * readback in the informant's own terms), what they ruled out, and what is still
 * wanted — in plain language. The count is deliberately elements, not a bare
 * percentage: a percentage cannot answer "what is it still looking for?".
 */
export function CoverageRail({
  coverage,
  elements = [],
  onMarkNotApplicable,
}: {
  coverage: CoverageRow[];
  elements?: ElementRow[];
  onMarkNotApplicable?: (elementId: string, reason: string) => void;
}) {
  const [open, setOpen] = useState<number | null>(null);
  // Ruling an element out asks for a reason inline. Deliberately not window.prompt:
  // a native dialog blocks the page and cannot carry the VMO2 treatment.
  const [naFor, setNaFor] = useState<string | null>(null);
  const [naReason, setNaReason] = useState('');

  function cancelNa() {
    setNaFor(null);
    setNaReason('');
  }

  function submitNa(elementId: string) {
    if (naReason.trim() === '' || !onMarkNotApplicable) return;
    onMarkNotApplicable(elementId, naReason.trim());
    cancelNa();
  }
  const byFacet = new Map(coverage.map((c) => [c.facetId, c.state]));
  const resolved = coverage.filter((c) => isTerminal(c.state)).length;

  const captured = elements.filter((e) => e.state === 'captured').length;
  const closed = elements.filter((e) => e.state !== 'outstanding').length;
  const pct = elements.length
    ? Math.round((closed / elements.length) * 100)
    : Math.round((resolved / FACETS.length) * 100);

  return (
    <div className="pc-card pc-rail" aria-label="Coverage">
      <div className="pc-railhead">
        <div className="t">Coverage</div>
        <div className="c">
          {elements.length > 0
            ? `${captured} of ${elements.length} things captured`
            : `${resolved}/${FACETS.length} resolved`}
        </div>
        <div
          className="pc-prog"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <i style={{ width: `${pct}%` }} />
        </div>
      </div>
      <ul className="pc-facets" style={{ listStyle: 'none', margin: 0 }}>
        {FACETS.map((facet) => {
          const state = byFacet.get(facet.id) ?? 'pending';
          const label = STATE_LABEL[state];
          const rows = elements.filter((e) => e.facetId === facet.id);
          const outstanding = rows.filter((e) => e.state === 'outstanding').length;
          const expanded = open === facet.id;
          const byId = new Map(rows.map((r) => [r.elementId, r]));

          return (
            <li key={facet.id} className={`pc-facet ${state}`}>
              <button
                type="button"
                className="pc-facet-head"
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? null : facet.id)}
              >
                <span className="fn">{facet.id}</span>
                <span style={{ flex: 1, textAlign: 'left' }}>{facet.name}</span>
                {rows.length > 0 && outstanding > 0 && (
                  <span className="t-caption pc-facet-count">{outstanding} to go</span>
                )}
                {label && (
                  <span className="t-caption" style={{ color: 'inherit', opacity: 0.7 }}>
                    {label}
                  </span>
                )}
                <i className="pc-cap" aria-hidden="true" />
              </button>

              {expanded && rows.length > 0 && (
                <ul className="pc-checklist">
                  {facet.elements.map((el) => {
                    const row = byId.get(el.id);
                    const elState: ElementStateValue = row?.state ?? 'outstanding';
                    return (
                      <li key={el.id} className={`pc-check ${elState}`}>
                        <span className="pc-check-mark" aria-hidden="true">
                          {MARK[elState]}
                        </span>
                        <span className="pc-check-body">
                          <span className="pc-check-label">{el.label}</span>
                          {elState === 'captured' && row?.summary && (
                            <span className="pc-check-note">{row.summary}</span>
                          )}
                          {elState === 'not_applicable' && (
                            <span className="pc-check-note">
                              Not applicable{row?.naReason ? ` — ${row.naReason}` : ''}
                            </span>
                          )}
                          {elState === 'outstanding' &&
                            onMarkNotApplicable &&
                            (naFor === el.id ? (
                              <span className="pc-check-naform">
                                <input
                                  className="pc-check-nainput"
                                  autoFocus
                                  value={naReason}
                                  placeholder="Why not? e.g. we never get those"
                                  onChange={(e) => setNaReason(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') submitNa(el.id);
                                    if (e.key === 'Escape') cancelNa();
                                  }}
                                />
                                <button
                                  type="button"
                                  className="pc-check-na"
                                  disabled={naReason.trim() === ''}
                                  onClick={() => submitNa(el.id)}
                                >
                                  Save
                                </button>
                                <button type="button" className="pc-check-na" onClick={cancelNa}>
                                  Cancel
                                </button>
                              </span>
                            ) : (
                              <button
                                type="button"
                                className="pc-check-na"
                                onClick={() => {
                                  setNaFor(el.id);
                                  setNaReason('');
                                }}
                              >
                                Doesn&rsquo;t apply to me
                              </button>
                            ))}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
