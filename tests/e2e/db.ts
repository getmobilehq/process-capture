import postgres from 'postgres';
import { E2E_DATABASE_URL } from './global-setup';

/**
 * Direct database access for the E2E specs.
 *
 * The specs read invite tokens and session rows straight from the database rather
 * than scraping them from the UI — a test that depends on the page to tell it what
 * to click next cannot detect the page lying. One short-lived connection per query
 * keeps this simple; volume is a handful of reads per run.
 */
export async function query<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const sql = postgres(E2E_DATABASE_URL, { max: 1 });
  try {
    return (await sql.unsafe(text, params as never[])) as unknown as T[];
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function one<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T | undefined> {
  return (await query<T>(text, params))[0];
}
