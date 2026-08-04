import { defineConfig } from 'drizzle-kit';

// Postgres (Cloud SQL in deployment, a local container or pglite in development).
export default defineConfig({
  schema: './lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://postgres:magpie@localhost:5434/magpie',
  },
});
