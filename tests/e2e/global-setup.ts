import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';

/**
 * Prepare a dedicated, freshly-seeded database for the E2E run. The Playwright
 * webServer runs the app against this same file (DATABASE_URL=file:./data/e2e.db).
 */
export default function globalSetup() {
  for (const suffix of ['', '-shm', '-wal']) {
    rmSync(`./data/e2e.db${suffix}`, { force: true });
  }
  const env = { ...process.env, DATABASE_URL: 'file:./data/e2e.db' };
  execSync('npm run db:migrate', { stdio: 'inherit', env });
  execSync('npm run seed', { stdio: 'inherit', env });
}
