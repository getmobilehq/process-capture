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

## State: 113 type errors left (was 744)

### Complete

- **`lib/db/schema.ts`** — pg dialect. `timestamptz`, `jsonb`, real `boolean`.
- **`lib/db/index.ts`** — postgres.js, pool capped at 5 (`DB_POOL_MAX`).
  **`DB` is typed as `PgDatabase<PgQueryResultHKT, typeof schema>`**, not the
  postgres-js type. That one change took the error count from 284 to 113: pinning
  `DB` to a single driver makes the pglite test double structurally incompatible,
  which is what forced 170 cascading errors. Do not narrow it again.
- **`lib/db/queries.ts`** — all 59 query functions async, both transactions
  converted. Zero errors.
- **`tests/helpers/db.ts`** — pglite, migrations applied per instance. Zero errors.
- **`drizzle/`** — regenerated as a single Postgres baseline (`0000_cute_bucky.sql`).
  The five SQLite-dialect migrations are gone; there was no production data.
- **`drizzle.config.ts`** — `dialect: 'postgresql'`.

### Remaining — 113 errors, all one shape

Every one is a missing `await` or a missing `async`, concentrated in:
`lib/engine/engine.ts` (17), `tests/integration/entry.test.ts` (16),
`scripts/eval.ts` (14), `lib/engine/model.ts` (10),
`app/console/projects/[id]/page.tsx` (7), `tests/unit/graph-persistence.test.ts` (7).

The common survivors are **awaits inside non-async callbacks** — `.map()`,
`.filter()`, `.find()` bodies that now call an async query — and **property access
on an un-parenthesised await** inside those callbacks.

**Do not use another broad regex.** Three passes were tried and each plateaued or
regressed (744 → 570 → 574 → 284 → 113, with two rounds of self-inflicted damage:
`whisperExt` wrongly marked async, and `await expect(x).resolves` mangled into
`(await expect(x)).resolves`). The remaining set is small enough to fix per file
with `npx tsc --noEmit` in a tight loop, which is both faster and safer now.

### Test suite

`npm test`: **10 of 21 files passing.** The failures are the files that still have
type errors, not behavioural failures — pglite itself works, migrations apply, and
the fixtures build. Once the awaits land, expect the suite to tell the truth about
the refactor.

### Before merging

`lint`, `typecheck`, `test`, `playwright test`, `build`, **and one live eval run** —
the engine's persistence path is where a dropped promise hides, and only the live
harness exercises it end to end.
