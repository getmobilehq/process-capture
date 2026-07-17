/**
 * Specification schema validator (BUILD-REQUIREMENTS FR-5.5). Every generated spec
 * is checked here before it can be saved; an invalid spec is a hard failure that
 * blocks session completion. Enforces the frontmatter contract (FR-5.2), the
 * structural provenance rule (P4), email absence (P7), and the facet-5 ordered-list
 * rule (FR-5.1) — without a YAML dependency, since the renderer owns the format.
 */

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

const REQUIRED_FRONTMATTER_KEYS = [
  'process_name',
  'department',
  'project_id',
  'informant',
  'interviewed',
  'duration_min',
  'provenance',
  'coverage',
  'open_items',
] as const;

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

/** Split leading `---`-fenced frontmatter from the body. */
export function splitFrontmatter(markdown: string): { frontmatter: string; body: string } | null {
  const m = markdown.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return null;
  return { frontmatter: m[1], body: m[2] };
}

/** Top-level YAML keys in a frontmatter block (lines like `key:` at column 0). */
export function topLevelKeys(frontmatter: string): string[] {
  return frontmatter
    .split('\n')
    .map((line) => line.match(/^([a-z_]+):/))
    .filter((x): x is RegExpMatchArray => Boolean(x))
    .map((x) => x[1]);
}

export function validateSpec(markdown: string): ValidationResult {
  const errors: string[] = [];

  const split = splitFrontmatter(markdown);
  if (!split) {
    return { ok: false, errors: ['Missing or malformed frontmatter (--- fence).'] };
  }
  const { frontmatter, body } = split;
  const keys = topLevelKeys(frontmatter);

  // Exact key set (FR-5.2).
  for (const key of REQUIRED_FRONTMATTER_KEYS) {
    if (!keys.includes(key)) errors.push(`Frontmatter missing required key: ${key}`);
  }
  for (const key of keys) {
    if (!(REQUIRED_FRONTMATTER_KEYS as readonly string[]).includes(key)) {
      errors.push(`Frontmatter has unexpected key: ${key}`);
    }
  }

  // Provenance is structural (P4).
  if (!/^provenance:\s*stated\s*$/m.test(frontmatter)) {
    errors.push('Frontmatter must declare `provenance: stated`.');
  }

  // Interviewed date is YYYY-MM-DD.
  if (!/^interviewed:\s*\d{4}-\d{2}-\d{2}\s*$/m.test(frontmatter)) {
    errors.push('`interviewed` must be a YYYY-MM-DD date.');
  }

  // duration_min is an integer.
  if (!/^duration_min:\s*\d+\s*$/m.test(frontmatter)) {
    errors.push('`duration_min` must be an integer.');
  }

  // coverage inline has all three counts.
  const coverageLine = frontmatter.match(/^coverage:\s*(.+)$/m)?.[1] ?? '';
  for (const field of ['answered', 'unknown', 'not_applicable']) {
    if (!new RegExp(`${field}:\\s*\\d+`).test(coverageLine)) {
      errors.push(`coverage is missing a numeric \`${field}\`.`);
    }
  }

  // Email must never appear (P7) — not in frontmatter, not in the body.
  if (EMAIL_RE.test(markdown)) {
    errors.push('An email address appears in the spec; emails must never be included (P7).');
  }

  // Body: twelve facet sections in order 1–12 (FR-5.3).
  const sectionNums = [...body.matchAll(/^##\s+(\d+)\.\s+/gm)].map((m) => Number(m[1]));
  const expected = Array.from({ length: 12 }, (_, i) => i + 1);
  if (sectionNums.length !== 12 || !expected.every((n, i) => sectionNums[i] === n)) {
    errors.push(`Body must contain twelve facet sections in order 1–12 (found: ${sectionNums.join(', ')}).`);
  }

  // Facet 5, when answered, must render as an ordered list (FR-5.1).
  const facet5 = extractSection(body, 5);
  if (facet5 && /answered/i.test(facet5.heading) && !/^\s*1\.\s+/m.test(facet5.content)) {
    errors.push('Facet 5 (Workflow & activities) is answered but does not render an ordered list of steps.');
  }

  return { ok: errors.length === 0, errors };
}

/** Extract a facet section's heading line and its content up to the next `##`. */
export function extractSection(
  body: string,
  facetId: number,
): { heading: string; content: string } | null {
  const re = new RegExp(`^##\\s+${facetId}\\.\\s+.*$`, 'm');
  const m = body.match(re);
  if (!m || m.index === undefined) return null;
  const start = m.index;
  const rest = body.slice(start + m[0].length);
  const next = rest.search(/^##\s+/m);
  const content = next === -1 ? rest : rest.slice(0, next);
  return { heading: m[0], content };
}
