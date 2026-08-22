import { NextResponse } from 'next/server';

/**
 * The 500 an API route returns when something unplanned went wrong.
 *
 * The exception goes to the server log, where the person debugging can read it;
 * the caller gets a sentence. The two audiences are different and want different
 * things — an unexpected exception message is written for us and carries our
 * internals in it: a driver's connection string, a file path, an SDK's account
 * identifiers. Returning it verbatim hands a map of the inside of the system to
 * whoever provoked the error.
 *
 * This is for the *unrecognised* failure only. A route's own domain errors —
 * `SpecValidationError`, `AutonomyError` and the rest — carry messages written to
 * be read by the person who caused them, and should keep being returned as they
 * are.
 */
export function serverError(context: string, err: unknown): NextResponse {
  console.error(`${context}:`, err);
  return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
}
