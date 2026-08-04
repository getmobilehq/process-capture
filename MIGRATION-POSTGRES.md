# Postgres migration — work in progress

On branch `migrate/postgres`. **`main` is green and unaffected** — nothing here is
merged. Started because SQLite cannot survive Cloud Run's ephemeral filesystem.

## Done

- **`lib/db/schema.ts` → pg dialect.** `pgTable`, `timestamptz` for the
  `timestamp_ms` columns, `jsonb` for the five JSON columns, real `boolean` for
  `statements.verbatim`. Text enums carry over unchanged. Original kept at
  `lib/db/schema.sqlite.bak` for diffing.
- **`lib/db/index.ts` → postgres.js + `drizzle-orm/postgres-js`.** Pool capped at 5
  per instance (`DB_POOL_MAX`) — Cloud Run multiplies instances and Cloud SQL caps
  total connections, so a generous per-instance pool is how three containers
  exhaust the server. Adds `closeDb()` for scripts and tests.
- **Driver call style in `queries.ts`.** better-sqlite3's `.get()` / `.all()` /
  `.run()` replaced: `.returning().get()` → `.returning().then((r) => r[0])`,
  `.all()` and `.run()` dropped (the builder is already thenable).
- **Local Postgres running** for the refactor:
  `docker run -d --name magpie-pg -e POSTGRES_PASSWORD=magpie -p 5434:5432 postgres:16`
  then `create database magpie`. Port 5434 because 5433 is taken by another project.
  `DATABASE_URL=postgres://postgres:magpie@localhost:5434/magpie`

## Not done — ~744 type errors remain

The mechanical pass made every exported query `async`, but **awaits need per-call
judgement** and a blind regex cannot supply it. The remaining work:

1. **`queries.ts` internals.** Functions that call other query functions need
   `await` on those calls, and the annotated return types need wrapping in
   `Promise<>`. `createSession` and `setElement` use `db.transaction` — postgres.js
   supports `async (tx) => {}`, and every statement inside must be awaited.
2. **Every caller.** The engine, the spec renderer, the API routes and the server
   components all call these synchronously today. Typecheck lists them; work
   outward from `lib/db/queries.ts` and the list shrinks fast.
3. **`drizzle.config.ts` + migrations.** Set `dialect: 'postgresql'`, delete
   `drizzle/0000`–`0004` (SQLite-dialect SQL) and regenerate as a single baseline —
   there is no production data to preserve.
4. **`tests/helpers/db.ts`.** Currently an in-memory SQLite per test. Options: a
   throwaway schema per test file against the local Postgres, or `pglite`. The
   suite is the safety net for this whole refactor, so it needs to work before the
   rest can be trusted.
5. **`lib/rate-limit.ts`.** Still an in-memory Map — fine at
   `--max-instances=1`, wrong above it. Either pin the instance count for the pilot
   or move the buckets into a table.

## Order I would take it

Fix `queries.ts` until it typechecks in isolation, then the test helper, then run
the suite — 192 tests and 10 E2E are what will tell you the refactor is faithful.
Only then chase the app-layer callers.

## Do not merge until

`npm run lint`, `npm run typecheck`, `npm test`, `npx playwright test` and
`npm run build` all pass, and the eval harness has had at least one live run — the
engine's persistence path is the part most likely to break silently under async.
