/**
 * Make a value safe to interpolate into a prompt.
 *
 * Strips line breaks and control characters, collapses runs of whitespace, and
 * caps the length. This is not an attempt to detect malicious wording — that is
 * unwinnable and unnecessary, because P1 already stops the model changing state.
 * It removes the specific affordance that turns a stored value into extra
 * *instructions*: the ability to break out of the line it sits on.
 *
 * Lives here rather than beside either caller because both `lib/entry.ts` and
 * `lib/db/queries.ts` need it, and they already import in one direction.
 */
const CONTROL_CHARS = new RegExp('[\\u0000-\\u001F\\u007F]', 'g');

export function sanitiseForPrompt(value: string, maxLength: number): string {
  return value.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}
