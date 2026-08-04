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

## Data layer complete

`lib/db/schema.ts`, `lib/db/index.ts` and `lib/db/queries.ts` all typecheck at
**zero errors**. All 59 query functions are async, return types wrapped, awaits
placed, and both transactions (`createSession`, `setElement`) converted to
`async (tx) => {}`. This was the load-bearing piece.

## Not done — ~574 type errors remain

Roughly 430 of them are in test files and **gated behind the test helper** — they
cannot be meaningfully fixed until it is converted. The app-code remainder is about
80, concentrated in `lib/engine/engine.ts` (56), `scripts/eval.ts` (14) and
`lib/engine/model.ts` (10).

**Regex passes have plateaued.** Successive blind transforms went 728 → 570 → 574:
each fixed some call sites and broke others, and one pass wrongly marked every
function in a file async merely because the file contained an await somewhere
(`whisperExt` in the transcribe route was collateral; it has been reverted). The
rest wants file-by-file work with the compiler in the loop, not more pattern
matching.

1. **`tests/helpers/db.ts` first — it gates ~430 errors.** Currently an in-memory
   SQLite per test. Two options, and this is a decision worth taking deliberately:
   **pglite** (in-process Postgres, no Docker needed for `npm test`, but a new
   dependency wanting a P6 entry) or **a unique schema per test file** against the
   local container (no new dependency, but the suite then requires Docker running).
   I would take pglite: a test suite that needs a running container is a test suite
   people stop running.
2. **Then `lib/engine/engine.ts`.** It is the largest app-code surface and the one
   where a missing `await` is most dangerous — a discarded promise there stops a
   turn persisting without raising anything.
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
