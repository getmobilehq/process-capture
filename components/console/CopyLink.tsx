'use client';

import { useState } from 'react';

export async function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <code
        style={{
          font: '400 12px/1.3 var(--font-mono)',
          background: 'var(--ink-25)',
          borderRadius: 'var(--radius-xs)',
          padding: '3px 6px',
          maxWidth: 220,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={url}
      >
        {url}
      </code>
      <button className="pc-btn ghost sm" type="button" onClick={() => void copy()}>
        {copied ? 'Copied' : 'Copy link'}
      </button>
    </span>
  );
}
