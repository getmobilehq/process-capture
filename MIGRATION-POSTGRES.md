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

## State: 51 type errors left (was 744), 12 of 21 test files passing

### Complete and at zero errors

- **`lib/db/schema.ts`** — pg dialect: `timestamptz`, `jsonb`, real `boolean`.
- **`lib/db/index.ts`** — postgres.js, pool capped at 5 (`DB_POOL_MAX`).
  **`DB` is `PgDatabase<PgQueryResultHKT, typeof schema>`, not the postgres-js
  type.** That single change took 284 → 113: pinning `DB` to one driver makes the
  pglite test double structurally incompatible. Do not narrow it again.
- **`lib/db/queries.ts`** — all 59 queries async, both transactions converted.
- **`tests/helpers/db.ts`** — pglite per test, migrations applied.
- **`scripts/eval.ts`** — its throwaway database is pglite too, so the eval harness
  runs on the same engine as deployment.
- **`lib/console.ts`** — `buildRegister` rewritten with `Promise.all`; a `.map()`
  callback cannot await.
- **`drizzle/`** — single Postgres baseline. **`drizzle.config.ts`** — `postgresql`.

### Remaining — 51 errors, thinly spread

`tests/unit/graph-persistence.test.ts` (7), `lib/engine/engine.ts` (6),
`tests/integration/entry.test.ts` (4), `lib/spec/draft.ts` (4),
`lib/eval/informant.ts` (4), `lib/eval/assertions.ts` (4), and a long tail of 1–3.

All of one family: **an await inside a callback that is not async**, or property
access on an un-parenthesised await. `lib/spec/draft.ts` and `lib/eval/*` are the
only files not yet touched at all.

### Do not use another broad regex

Four passes were tried. Each plateaued or regressed, and three caused damage that
had to be repaired: `whisperExt` wrongly marked async; `await expect(x).resolves`
mangled into `(await expect(x)).resolves`; and synchronous functions
(`deriveFacetState`, `facetMeter`) given `Promise<>` return types they should never
have had. The count went 744 → 570 → 574 → 284 → 113 → 88 → 51, and the two rises
were self-inflicted.

51 is small enough to fix per file with `npx tsc --noEmit` in a tight loop. That is
now both faster and safer than another pattern match.

### Before merging

`lint`, `typecheck`, `test`, `playwright test`, `build`, **and one live eval run** —
the engine's persistence path is where a dropped promise hides silently, and only
the live harness exercises it end to end.
