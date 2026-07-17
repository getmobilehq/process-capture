# DECISIONS

One line per decision taken where BUILD-REQUIREMENTS.md was silent: context,
decision, why it is the minimal option (§10).

## Phase 0 — Scaffold

- **D0.1 · Brand fonts** — FR-6.1 names four core Aeonik weights, but the supplied
  `colors_and_type.css` declares `@font-face` for all 14. Copied all 14 woff files
  into `/public/brand/fonts` and import the vendor stylesheet verbatim, rather than
  editing it. Why minimal: honours "copy tokens and fonts; do not restyle" (§4) and
  avoids 404s, at the cost of ~10 extra small font files.
- **D0.2 · SQLite driver** — Using `better-sqlite3` (synchronous, native) with
  `drizzle-orm/better-sqlite3`. Why minimal: single-process Next server, no async
  pool needed; matches P6 (SQLite before Postgres, one deployable).
- **D0.3 · Model default** — `.env.example` keeps the brief's `claude-sonnet-4-6`
  default. Per P5 the id is pure configuration; it can be bumped to `claude-sonnet-5`
  or `claude-opus-4-8` via env with no code change.
- **D0.4 · E2E model** — Playwright and integration tests run with `MOCK_MODEL=1`,
  which short-circuits the Anthropic client with a deterministic scripted engine.
  Why minimal: gates in phases 2–5 must be reproducible and offline; the live model
  is exercised only by the eval harness (§9, Phase 6).
- **D0.5 · ESLint** — Using the legacy `.eslintrc.json` + `next lint` (eslint 8),
  not flat config, to match `eslint-config-next` for Next 14. Why minimal: the
  supported, zero-friction path for this Next version.

## Phase 1 — Data layer

- **D1.1 · Target processes location** — §5's Project row does not list where
  FR-1.2/FR-2.3's optional target-process names live. Stored them as a JSON
  `target_processes` column on `projects`. Why minimal: no new table for a small
  list owned entirely by the project.
- **D1.2 · Append-only enforcement** — Enforced at the query-module boundary (no
  update/delete exported for turns/statements; corrections go through
  `supersedeStatement`) rather than via DB triggers. Why minimal: P6 — the app is
  the only writer; a trigger adds migration surface for no extra guarantee.
- **D1.3 · Live statement set** — "Superseded" is derived (`listLiveStatements`
  filters out any statement whose id appears as another's `supersedesId`) rather
  than stored as a flag. Why minimal: keeps statements strictly append-only with
  no mutable status column.
