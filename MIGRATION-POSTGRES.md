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

## State: complete on this branch — 0 type errors, 192/192 tests, build green

`lint` ✓ · `typecheck` ✓ · **192 unit/integration tests, 21/21 files** ✓ · `build` ✓

### What changed

- **`lib/db/schema.ts`** — pg dialect: `timestamptz`, `jsonb`, real `boolean`.
- **`lib/db/index.ts`** — postgres.js, pool capped at 5 (`DB_POOL_MAX`).
  **`DB` is `PgDatabase<PgQueryResultHKT, typeof schema>`, not the postgres-js
  type.** That one line fixed 171 errors: pinning `DB` to a single driver makes the
  pglite test double structurally incompatible. **Do not narrow it again.**
- **`lib/db/queries.ts`** — all 59 queries async; both transactions converted.
- **`tests/helpers/db.ts`** and **`scripts/eval.ts`** — pglite. Tests and evals run
  on the same engine as Cloud SQL, with no container needed for `npm test`.
- **`scripts/migrate.ts`, `scripts/seed.ts`** — pg migrator; `.get()` removed.
- **`lib/console.ts`, `app/console/page.tsx`, `app/i/[token]/interview/page.tsx`** —
  `Promise.all` where a `.map()` callback needed to await, which it cannot.
- **`drizzle/`** — single Postgres baseline. **`drizzle.config.ts`** — `postgresql`.

### Still to do before this is deployable

1. **`lib/rate-limit.ts` is still an in-memory Map.** Correct at
   `--max-instances=1`, wrong above it: the limit becomes N × instances. Either pin
   the instance count for the pilot or move the buckets into a table.
2. **Playwright has not been re-run** — it needs a Postgres for its own database,
   where it previously used a SQLite file. `playwright.config.ts` still sets
   `DATABASE_URL=file:./data/e2e.db`.
3. **The eval harness has not had a live run** on Postgres. This is the one that
   matters most: the engine's persistence path is where a dropped `await` hides
   silently, and only the live harness exercises it end to end. Unit tests use a
   mocked model.
4. **`data/*.db` and `better-sqlite3`** can be removed once the above pass.

### Lesson recorded

Seven regex passes; three caused damage needing repair (`whisperExt` wrongly async;
`await expect(x).resolves` mangled; synchronous functions given `Promise<>` return
types). The count went 744 → 570 → 574 → 284 → 113 → 88 → 51 → 0, and every rise
was self-inflicted. The last 51 went quickly precisely because they were fixed
file-by-file with `tsc` in the loop rather than by another pattern match.
