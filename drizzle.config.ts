import { defineConfig } from 'drizzle-kit';

// DATABASE_URL is a libsql-style URL (file:./data/app.db); drizzle-kit's
// better-sqlite driver wants a bare filesystem path, so strip the scheme.
const url = process.env.DATABASE_URL ?? 'file:./data/app.db';
const dbPath = url.replace(/^file:/, '');

export default defineConfig({
  schema: './lib/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: { url: dbPath },
});
