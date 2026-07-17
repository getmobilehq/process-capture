/**
 * Central runtime configuration (P5 — models are configuration; no
 * model-specific logic lives in application code). Every environment-derived
 * value the app depends on is read here, once, with sensible defaults matching
 * BUILD-REQUIREMENTS §4.
 */

function str(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

function int(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
  model: str('MODEL', 'claude-sonnet-4-6'),
  modelTemperature: int('MODEL_TEMPERATURE', 1),
  modelMaxTokens: int('MODEL_MAX_TOKENS', 4096),
  databaseUrl: str('DATABASE_URL', 'file:./data/app.db'),
  baseUrl: str('BASE_URL', 'http://localhost:3000'),
  adminPassword: process.env.ADMIN_PASSWORD ?? '',
  retentionDays: int('RETENTION_DAYS', 365),
  sessionMaxTurns: int('SESSION_MAX_TURNS', 60),
  surveyUrl: process.env.SURVEY_URL ?? '',
  /** MOCK_MODEL short-circuits the Anthropic client for deterministic E2E/tests. */
  mockModel: process.env.MOCK_MODEL === '1',
} as const;

/** Bare filesystem path from a file: URL, for better-sqlite3. */
export function dbFilePath(url: string = config.databaseUrl): string {
  return url.replace(/^file:/, '');
}
