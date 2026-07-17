import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**'],
    globals: true,
    passWithNoTests: true,
    // Tests never call the live model; the deterministic mock drives the engine.
    env: { MOCK_MODEL: '1', ADMIN_PASSWORD: 'test-admin' },
  },
});
