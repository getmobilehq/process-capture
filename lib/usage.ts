/**
 * Process-wide token accounting, used by the eval harness (§9 cost log). Every
 * live model call (engine, spec drafting, simulated informant) reports its usage
 * here so a run can log total spend.
 */
export const usage = { inputTokens: 0, outputTokens: 0, calls: 0 };

export function addUsage(u: { input_tokens?: number | null; output_tokens?: number | null }): void {
  usage.inputTokens += u.input_tokens ?? 0;
  usage.outputTokens += u.output_tokens ?? 0;
  usage.calls += 1;
}

export function resetUsage(): void {
  usage.inputTokens = 0;
  usage.outputTokens = 0;
  usage.calls = 0;
}

export function snapshotUsage(): { inputTokens: number; outputTokens: number; calls: number } {
  return { ...usage };
}
