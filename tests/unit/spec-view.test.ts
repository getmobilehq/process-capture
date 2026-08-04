import { describe, it, expect } from 'vitest';
import { parseSpec } from '@/components/graph/SpecView';
import { readFileSync, existsSync } from 'node:fs';

const REAL = '/Users/josephagunbiade/Downloads/spec-fraud-resolution-v1.md';

const sample = `---
process_name: "Fraud Resolution"
department: "Customer Support"
informant: {name: "Matthew Ebanks", role: "Customer Service Team Manager"}
interviewed: 2026-08-03
duration_min: 61
provenance: stated
coverage: {answered: 12, unknown: 0, elements_captured: 40}
not_applicable_items: []
open_items:
  - "The manager's manager limit is unknown."
  - "Second item."
---

# Process specification — Fraud Resolution

## 1. Process identity & context — answered

Body text here.
`;

describe('specification rendering', () => {
  it('reads the provenance fields the renderer writes', () => {
    const { meta } = parseSpec(sample);
    expect(meta.processName).toBe('Fraud Resolution');
    expect(meta.department).toBe('Customer Support');
    expect(meta.informant).toBe('Matthew Ebanks · Customer Service Team Manager');
    expect(meta.interviewed).toBe('2026-08-03');
    expect(meta.durationMin).toBe('61');
    expect(meta.provenance).toBe('stated');
  });

  it('breaks the coverage block into readable stats', () => {
    const { meta } = parseSpec(sample);
    expect(meta.coverage).toContainEqual({ label: 'answered', value: '12' });
    expect(meta.coverage).toContainEqual({ label: 'elements captured', value: '40' });
  });

  it('lists open items, which are what a reader most needs to see', () => {
    const { meta } = parseSpec(sample);
    expect(meta.openItems).toHaveLength(2);
    expect(meta.openItems[0]).toMatch(/manager's manager limit/);
  });

  it('treats an empty list as empty rather than as one blank item', () => {
    expect(parseSpec(sample).meta.notApplicable).toEqual([]);
  });

  it('separates the body from the frontmatter', () => {
    const { body } = parseSpec(sample);
    expect(body).not.toContain('process_name');
    expect(body).toContain('## 1. Process identity & context — answered');
  });

  it('degrades gracefully on markdown with no frontmatter', () => {
    const { meta, body } = parseSpec('# Just a heading\n\nSome text.');
    expect(meta.coverage).toEqual([]);
    expect(body).toContain('Just a heading');
  });

  // The renderer's own output is the only input this ever sees.
  it.skipIf(!existsSync(REAL))('parses a real generated specification', () => {
    const { meta, body } = parseSpec(readFileSync(REAL, 'utf8'));
    expect(meta.informant).toMatch(/Matthew Ebanks/);
    expect(meta.openItems.length).toBeGreaterThan(0);
    expect(meta.coverage.find((c) => c.label === 'answered')?.value).toBe('12');
    expect(body.match(/^## /gm)).toHaveLength(12);
  });
});
