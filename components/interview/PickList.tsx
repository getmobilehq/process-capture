'use client';

import { useState } from 'react';

export interface PickOption {
  entityId: string;
  name: string;
  source: 'taxonomy' | 'this_interview' | 'prior_interview';
  selected: boolean;
  status: 'confirmed' | 'pending';
}

/**
 * A pick-list facet's option set (delta v1.1 R2.1). Several facets are closed sets
 * in practice; offering them turns a tiring recall exercise into a quick
 * confirmation and keeps vocabulary consistent across informants.
 *
 * The source label is shown, never hidden — a colleague's answer is presented as a
 * colleague's answer, not as established fact (P2). "Something else" is always
 * present and visually co-equal, so the list never becomes a cage.
 */
const SOURCE_LABEL: Record<PickOption['source'], string> = {
  taxonomy: 'used at VMO2',
  this_interview: 'you mentioned this',
  prior_interview: 'a colleague mentioned this',
};

export function PickList({
  title,
  options,
  onSelect,
  onDescribe,
  busy = false,
}: {
  title: string;
  options: PickOption[];
  onSelect: (entityId: string) => void;
  onDescribe: (name: string) => void;
  busy?: boolean;
}) {
  const [describing, setDescribing] = useState(false);
  const [draft, setDraft] = useState('');

  if (options.length === 0) return null;

  function submitDraft() {
    const name = draft.trim();
    if (name === '') return;
    onDescribe(name);
    setDraft('');
    setDescribing(false);
  }

  return (
    <div className="pc-picklist">
      <div className="pc-picklist-head">{title}</div>
      <ul className="pc-picklist-opts">
        {options.map((o) => (
          <li key={o.entityId}>
            <button
              type="button"
              className={`pc-pick ${o.selected ? 'on' : ''}`}
              aria-pressed={o.selected}
              disabled={busy || o.selected}
              onClick={() => onSelect(o.entityId)}
            >
              <span className="pc-pick-tick" aria-hidden="true">
                {o.selected ? '✓' : '+'}
              </span>
              <span className="pc-pick-name">{o.name}</span>
              <span className="pc-pick-src">{SOURCE_LABEL[o.source]}</span>
            </button>
          </li>
        ))}
      </ul>

      {describing ? (
        <div className="pc-pick-other">
          <input
            className="pc-check-nainput"
            autoFocus
            value={draft}
            placeholder="What do you call it?"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitDraft();
              if (e.key === 'Escape') setDescribing(false);
            }}
          />
          <button type="button" className="pc-check-na" disabled={draft.trim() === ''} onClick={submitDraft}>
            Add
          </button>
          <button type="button" className="pc-check-na" onClick={() => setDescribing(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <button type="button" className="pc-pick pc-pick-escape" onClick={() => setDescribing(true)}>
          <span className="pc-pick-tick" aria-hidden="true">
            +
          </span>
          <span className="pc-pick-name">Something else — let me describe it</span>
        </button>
      )}
    </div>
  );
}
