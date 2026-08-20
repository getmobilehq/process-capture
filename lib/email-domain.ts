/**
 * Near-miss domain detection for console accounts.
 *
 * Two accounts were created at `@virginmedia.co.uk` by someone who believed they
 * had typed `@virginmediao2.co.uk`. Nothing was wrong with the code — the address
 * was saved exactly as submitted — but browser autofill changes a field while you
 * are looking at a different one, and the mistake is invisible until a colleague
 * cannot sign in.
 *
 * So the console compares a new address against the domains already in use. It
 * does not block: the first account on a new domain is a legitimate thing to
 * create, and a tool that argues with a correct answer trains people to click
 * through warnings. It asks once, showing both, and takes the answer.
 */

/** Levenshtein distance, iterative and bounded to the shorter string's row. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[b.length];
}

export function domainOf(email: string): string {
  const at = email.lastIndexOf('@');
  return at === -1 ? '' : email.slice(at + 1).toLowerCase();
}

/**
 * A domain already in use that this one looks like a slip of — or null.
 *
 * "Looks like" is deliberately narrow: one contains the other (the `o2` case, and
 * the commonest autofill outcome), or they are within three edits. Wider than that
 * and it fires on genuinely different departments.
 */
export function nearMissDomain(email: string, existing: readonly string[]): string | null {
  const domain = domainOf(email);
  if (!domain) return null;

  const known = [...new Set(existing.map(domainOf).filter(Boolean))];
  if (known.includes(domain)) return null; // already in use — nothing to query

  for (const other of known) {
    if (other.includes(domain) || domain.includes(other)) return other;
    if (editDistance(domain, other) <= 3) return other;
  }
  return null;
}
