import { defineConfig, devices } from '@playwright/test';
import { E2E_DATABASE_URL } from './tests/e2e/global-setup';

const PORT = Number(process.env.PORT ?? 3100);
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  timeout: 60_000,
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // E2E runs against the mocked-model build; MOCK_MODEL short-circuits Anthropic.
    // NEXT_DIST_DIR keeps this server's build output away from a dev server
    // running in the same tree; sharing .next breaks whichever started first.
    command: `MOCK_MODEL=1 ADMIN_PASSWORD=test-admin DATABASE_URL=${E2E_DATABASE_URL} NEXT_DIST_DIR=.next-e2e PORT=${PORT} npm run dev`,
    url: BASE_URL,
    // Always let Playwright own the server lifecycle so it never reuses a server
    // holding a stale handle to the DB that global-setup re-seeds.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
