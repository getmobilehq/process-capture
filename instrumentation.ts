/**
 * Process-level resilience for the pilot server (BUILD-REQUIREMENTS Phase 7).
 * A single interview turn makes several live model calls; a stray rejection must
 * not take the whole server down mid-interview. Log loudly, keep serving.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    process.on('unhandledRejection', (reason) => {
      console.error('[unhandledRejection]', reason);
    });
    process.on('uncaughtException', (err) => {
      console.error('[uncaughtException]', err);
    });
  }
}
