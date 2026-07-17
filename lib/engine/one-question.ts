/**
 * One-question-per-turn heuristic (FR-3.3): at most one '?' outside quoted
 * informant speech. Quoted spans (straight and curly quotes) are stripped first so
 * a question quoted back to the informant does not count.
 */
const QUOTED = /["“”'‘’][^"“”'‘’]*["“”'‘’]/g;

export function countQuestions(text: string): number {
  const stripped = text.replace(QUOTED, '');
  return (stripped.match(/\?/g) ?? []).length;
}

export function violatesOneQuestion(text: string): boolean {
  return countQuestions(text) > 1;
}
