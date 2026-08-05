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
  // Optional voice input: OpenAI Whisper transcription (V1.1 enhancement).
  // When unset, the mic button is not offered.
  openaiApiKey: process.env.OPENAI_API_KEY ?? '',
  transcribeModel: str('TRANSCRIBE_MODEL', 'whisper-1'),
  modelTemperature: int('MODEL_TEMPERATURE', 1),
  modelMaxTokens: int('MODEL_MAX_TOKENS', 4096),
  databaseUrl: str('DATABASE_URL', ''),
  baseUrl: str('BASE_URL', 'http://localhost:3000'),
  adminPassword: process.env.ADMIN_PASSWORD ?? '',
  retentionDays: int('RETENTION_DAYS', 365),
  sessionMaxTurns: int('SESSION_MAX_TURNS', 60),
  // Delta v1.1 R9.1 — the interview has a felt horizon. Configurable per pilot.
  questionBudget: int('QUESTION_BUDGET', 25),
  facetFollowUpCap: int('FACET_FOLLOWUP_CAP', 3),
  surveyUrl: process.env.SURVEY_URL ?? '',
  /** MOCK_MODEL short-circuits the Anthropic client for deterministic E2E/tests. */
  mockModel: process.env.MOCK_MODEL === '1',
  /** True when optional voice input is configured. */
  get voiceEnabled(): boolean {
    return Boolean(process.env.OPENAI_API_KEY);
  },
  /**
   * The to-be process map (delta R5.4). Off unless explicitly enabled, because
   * R5.4's verification gate is not built: nothing yet stops a machine-generated,
   * unreviewed change-set reaching a handover report, and the delta locks that
   * decision. Turn this on only for analysis, never for a pilot where the output
   * could be mistaken for an approved recommendation.
   */
  get toBeEnabled(): boolean {
    return process.env.ENABLE_TOBE === '1';
  },
} as const;

