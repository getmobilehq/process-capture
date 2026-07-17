# STATUS — Process capture build log

Audit trail for human review. One entry per phase: date, what was built, gate
results, open concerns (§10).

---

## Phase 0 · Scaffold — complete (2026-07-17)

**Built**

- Next.js 14 (App Router, TypeScript) app shell: `app/layout.tsx`, `app/page.tsx`,
  `app/globals.css`.
- Tooling: Drizzle + better-sqlite3, Vitest, Playwright, ESLint (`next lint`),
  Prettier, `tsx` scripts. Config files for each.
- `lib/config.ts` — central env configuration (P5).
- `.env.example` with all §4 variables; `.gitignore`.
- Reference artefacts copied to `/reference` (read-only): approved demo, spec,
  `VMO2_Design_System/`.
- Brand assets copied to `/public/brand`: `colors_and_type.css`, all Aeonik Pro
  weights, `vmo2-logo.png`.
- `CLAUDE.md` (builder constitution), `DECISIONS.md`, `STATUS.md`.

**Gate** — `npm run lint`, `npm run typecheck`, `npm test` (empty suite ok),
`npm run build` all green.

- [x] lint — `✔ No ESLint warnings or errors`
- [x] typecheck — clean (`tsc --noEmit`)
- [x] test — `No test files found, exiting with code 0` (empty suite ok)
- [x] build — `✓ Compiled successfully`, 4 static routes, no config warnings

**Open concerns** — `npm audit` reports 14 vulnerabilities in transitive dev
dependencies (drizzle-kit/eslint toolchain); none in the runtime path. Revisit at
Phase 7 hardening.

---

## Phase 1 · Data layer — complete (2026-07-17)

**Built**

- `lib/facets/facets.ts` — the 12-facet machine spec (§7), single source of truth
  (id, name, objective, probes, answeredWhen, example). Facet 6 carries the £-band
  approval-tier calibration example; facet 12 probes include longest-task and
  where-work-queues.
- `lib/engine/coverage.ts` — coverage state machine: legal transitions, terminal
  immutability, `assertTransition`, `allResolved` (P3, FR-3.2).
- `lib/db/schema.ts` — full §5 schema (8 tables) with nanoid ids, timestamp_ms,
  and all §5 indexes (invite-token unique, statement(session,facet),
  coverage(session,facet) unique, turn(session,seq) unique for idempotency).
- `lib/db/index.ts` — better-sqlite3 (WAL, foreign_keys ON) + Drizzle client.
- `lib/db/queries.ts` — the only sanctioned read/write surface; append-only
  turns/statements, `setCoverage` validates via the state machine, `createSession`
  seeds 12 pending coverage rows atomically.
- `drizzle/0000_*.sql` migration; `scripts/migrate.ts`, `scripts/seed.ts`.
- Seed creates the "Consumer operations" demo campaign with 3 interviewees
  (idempotent). `npm run setup` runs migrate + seed cleanly.
- Test helper `tests/helpers/db.ts` (in-memory DB + migrations).

**Gate** — unit tests green.

- [x] lint — clean
- [x] typecheck — clean
- [x] test — 10 passing: append-only supersede path, coverage transition legality
      (legal + illegal + terminal immutability), 12-row seeding, invite-token
      uniqueness (distinct + DB unique-constraint rejection)
- [x] build — `✓ Compiled successfully`

**Open concerns** — none.
