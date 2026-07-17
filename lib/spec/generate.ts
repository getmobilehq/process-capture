/**
 * Generate, validate, and persist a specification (FR-5.4, FR-5.5). An invalid
 * spec throws SpecValidationError and is never saved — a hard failure that blocks
 * session completion.
 */
import type { DB } from '@/lib/db';
import { getDb } from '@/lib/db';
import { saveSpec } from '@/lib/db/queries';
import type { Spec } from '@/lib/db/schema';
import { renderSpec } from './render';
import { validateSpec } from './validate';

export class SpecValidationError extends Error {
  constructor(readonly errors: string[]) {
    super(`Generated spec failed validation: ${errors.join(' | ')}`);
    this.name = 'SpecValidationError';
  }
}

export async function generateAndSaveSpec(sessionId: string, db: DB = getDb()): Promise<Spec> {
  const rendered = await renderSpec(sessionId, db);
  const result = validateSpec(rendered.markdown);
  if (!result.ok) throw new SpecValidationError(result.errors);
  return saveSpec(
    {
      sessionId,
      markdown: rendered.markdown,
      coverageSummary: rendered.coverageSummary,
      openItems: rendered.openItems,
    },
    db,
  );
}
