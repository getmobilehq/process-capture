import { describe, it, expect } from 'vitest';
import { validateSpec, splitFrontmatter, topLevelKeys } from '@/lib/spec/validate';

/** A minimal but valid spec: correct frontmatter + 12 ordered sections, facet 5 a list. */
function validSpec(): string {
  const front = [
    '---',
    'process_name: "Billing complaint resolution"',
    'department: "Consumer operations"',
    'project_id: "proj_1"',
    'informant: {name: "Priya Nair", role: "Complaints advisor"}',
    'interviewed: 2026-07-17',
    'duration_min: 32',
    'provenance: stated',
    'coverage: {answered: 11, unknown: 1, not_applicable: 0, elements_captured: 37, elements_outstanding: 0, elements_not_applicable: 3}',
    'not_applicable_items: []',
    'open_items: []',
    '---',
  ].join('\n');

  const sections = Array.from({ length: 12 }, (_, i) => {
    const n = i + 1;
    if (n === 5) return `## 5. Workflow & activities — answered\n\n1. Advisor reads the case in the CRM.\n2. Advisor raises a credit.`;
    return `## ${n}. Facet ${n} — answered\n\nSome faithful prose about facet ${n}.`;
  }).join('\n\n');

  return `${front}\n\n# Process specification\n\n${sections}\n`;
}

describe('spec validator — valid spec', () => {
  it('accepts a well-formed spec', () => {
    const r = validateSpec(validSpec());
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('splits frontmatter and reads top-level keys', () => {
    const split = splitFrontmatter(validSpec())!;
    expect(split).not.toBeNull();
    expect(topLevelKeys(split.frontmatter)).toContain('provenance');
    expect(topLevelKeys(split.frontmatter)).toContain('open_items');
  });
});

describe('spec validator — failure cases (FR-5.5)', () => {
  it('rejects a spec with no frontmatter', () => {
    const r = validateSpec('# just a body\n\n## 1. x — answered\n');
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/frontmatter/i);
  });

  it('rejects a missing required key', () => {
    const bad = validSpec().replace(/^duration_min: 32\n/m, '');
    const r = validateSpec(bad);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/duration_min/);
  });

  it('rejects an unexpected frontmatter key', () => {
    const bad = validSpec().replace('provenance: stated', 'provenance: stated\nsecret_owner: "x"');
    const r = validateSpec(bad);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/unexpected key: secret_owner/);
  });

  it('rejects provenance other than stated (P4)', () => {
    const bad = validSpec().replace('provenance: stated', 'provenance: actual');
    const r = validateSpec(bad);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/provenance: stated/);
  });

  it('rejects any email address (P7)', () => {
    const bad = validSpec().replace(
      'Some faithful prose about facet 1.',
      'The owner is priya.nair@example.com.',
    );
    const r = validateSpec(bad);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/email/i);
  });

  it('rejects a bad interviewed date', () => {
    const bad = validSpec().replace('interviewed: 2026-07-17', 'interviewed: 17 July 2026');
    const r = validateSpec(bad);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/YYYY-MM-DD/);
  });

  it('rejects a non-integer duration', () => {
    const bad = validSpec().replace('duration_min: 32', 'duration_min: about 30');
    const r = validateSpec(bad);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/duration_min/);
  });

  it('rejects coverage missing a count', () => {
    const bad = validSpec().replace(
      'coverage: {answered: 11, unknown: 1, not_applicable: 0, elements_captured: 37, elements_outstanding: 0, elements_not_applicable: 3}',
      'coverage: {answered: 11, unknown: 1}',
    );
    const r = validateSpec(bad);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/not_applicable/);
  });

  it('rejects fewer than twelve ordered sections', () => {
    const bad = validSpec().replace(/## 12\. Facet 12 — answered\n\nSome faithful prose about facet 12\./, '');
    const r = validateSpec(bad);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/twelve facet sections/);
  });

  it('rejects an answered facet 5 with no ordered list (FR-5.1)', () => {
    const bad = validSpec().replace(
      '## 5. Workflow & activities — answered\n\n1. Advisor reads the case in the CRM.\n2. Advisor raises a credit.',
      '## 5. Workflow & activities — answered\n\nThe advisor reads the case then raises a credit.',
    );
    const r = validateSpec(bad);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/ordered list/);
  });
});
