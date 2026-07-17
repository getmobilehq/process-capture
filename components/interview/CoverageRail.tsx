import { FACETS } from '@/lib/facets/facets';
import { isTerminal, type CoverageStateValue } from '@/lib/engine/coverage';

interface CoverageRow {
  facetId: number;
  state: CoverageStateValue;
}

const STATE_LABEL: Record<CoverageStateValue, string> = {
  pending: '',
  partial: 'in progress',
  answered: 'answered',
  unknown_to_informant: 'not known',
  not_applicable: 'n/a',
};

/**
 * The 12-facet coverage rail (FR-3.5): live state per facet, a progress count and
 * a gradient bar. Capsule + endcap-circle motif; state colours match the demo
 * (green answered, yellow partial, pink unknown, grey pending).
 */
export function CoverageRail({ coverage }: { coverage: CoverageRow[] }) {
  const byFacet = new Map(coverage.map((c) => [c.facetId, c.state]));
  const resolved = coverage.filter((c) => isTerminal(c.state)).length;
  const answered = coverage.filter((c) => c.state === 'answered').length;
  const pct = Math.round((resolved / FACETS.length) * 100);

  return (
    <div className="pc-card pc-rail" aria-label="Coverage">
      <div className="pc-railhead">
        <div className="t">Coverage</div>
        <div className="c">
          {answered} answered · {resolved}/{FACETS.length} resolved
        </div>
        <div className="pc-prog" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <i style={{ width: `${pct}%` }} />
        </div>
      </div>
      <ul className="pc-facets" style={{ listStyle: 'none', margin: 0 }}>
        {FACETS.map((facet) => {
          const state = byFacet.get(facet.id) ?? 'pending';
          const label = STATE_LABEL[state];
          return (
            <li key={facet.id} className={`pc-facet ${state}`}>
              <span className="fn">{facet.id}</span>
              <span style={{ flex: 1 }}>{facet.name}</span>
              {label && (
                <span className="t-caption" style={{ color: 'inherit', opacity: 0.7 }}>
                  {label}
                </span>
              )}
              <i className="pc-cap" aria-hidden="true" />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
