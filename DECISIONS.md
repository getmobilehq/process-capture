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

## Phase 2 — Entry flow

- **D2.1 · Editable identity persists** — FR-2.1 says the prefilled name/email/role
  are editable but is silent on whether edits stick. `startSession` writes any
  changed field back to the interviewee (the register). Why minimal: the register
  is the single home for identity; persisting keeps the spec attribution correct
  without a separate edit surface. Email stays in the register only (P7).
- **D2.2 · Start via server action** — The entry form posts to a Next server action
  (`startInterview`) rather than a REST route. Why minimal: no extra API surface;
  the server owns the state transition (P1) and the underlying `startSession` is
  unit/integration-tested directly.
- **D2.3 · Shared brand-ui.css** — Reproduced the demo's component classes
  (capsule+endcap, buttons, coverage rail, chat, findings) once in
  `app/brand-ui.css`, mapped onto the vendor tokens, for reuse across interview and
  console. Why minimal: one styling source keyed to the tokens, matching FR-6.2.
- **D2.4 · E2E database** — Playwright seeds a dedicated `data/e2e.db` via a global
  setup and the app runs against it (`MOCK_MODEL=1`). Tests read tokens/session
  rows directly from that file with better-sqlite3. Why minimal: reproducible,
  offline, no console dependency (console arrives in Phase 5).

## Phase 3 — Interview engine

- **D3.1 · Turn transport is a single JSON exchange, not token streaming** — FR-3.1
  says the agent turn is "streamed to the client". V1 sends the whole agent turn as
  one JSON response (`POST /api/interview/{id}/turn`) and the client appends it,
  with a typing indicator during the request. Why minimal: the engine's tool loop,
  validation, and persistence are transport-agnostic; token-level SSE streaming adds
  client/stream plumbing with no gate impact and is deferred to V1.1. **Flag for
  Paul:** this is the one place a stated FR is simplified — the conversational
  latency (one model round-trip per turn) is acceptable for a 25–40 min interview.
- **D3.2 · Intermediate tool calls are not persisted as turns** — Only the final
  agent question and the user answer are stored as `Turn` rows; the per-turn
  tool_use/tool_result exchange lives only in the in-flight message array. Resume
  replays turns + injects live coverage into the system prompt (FR-3.8), so the
  model needs no tool-call history. Why minimal: keeps the transcript and model
  context lean; state of record is the DB (statements, coverage), per P1.
- **D3.3 · `maxTurns` override on `processUserTurn`** — The hard-stop cap is
  `config.sessionMaxTurns` but overridable per call, purely so the FR-3.7 gate can
  trigger truncation deterministically without re-importing a cached config.
- **D3.4 · Deterministic mock model** — `MOCK_MODEL=1` routes to a scripted
  responder that reads live coverage and resolves one facet per user turn (facet 9 →
  unknown, rest → answered), then ends. It is the offline arbiter for the Phase 3–5
  gates; the live model is wired and evaluated in Phase 6 (§9).

## Phase 4 — Review + spec

- **D4.1 · Confirm is an explicit action** — Review offers a "Finish" button
  (`POST /confirm`) to complete, and a text box for corrections (ordinary turns,
  FR-4.1). Why minimal: distinguishing confirm from correction by parsing free text
  is fragile; an explicit button is unambiguous and the correction path reuses the
  engine loop.
- **D4.2 · Timing persisted before validation** — `completeInterview` writes
  `completedAt`/`durationSec` (status still `review`), then generates + validates the
  spec; only a valid spec flips status to `complete` (FR-5.5). An invalid spec leaves
  the session in review with nothing saved — completion is genuinely blocked.
- **D4.3 · Frontmatter without a YAML dependency** — The renderer emits the fixed
  frontmatter shape by hand and the validator checks it with targeted line/regex
  rules (exact key set, `provenance: stated`, email-absence, coverage counts, date,
  duration). Why minimal: P6 — the format is owned by our own renderer, so a YAML
  parser dependency buys nothing.
- **D4.4 · Mock review corrections are acknowledged, not superseded** — Under
  `MOCK_MODEL`, a correction sent during review gets a short acknowledgement and
  records no statement; the live model records a superseding statement. The gate
  tests the confirm→spec path, not correction fidelity (that is covered by §9 evals).
- **D4.5 · Playwright owns the server** — `reuseExistingServer: false` so Playwright
  always starts/stops its own dev server; a reused server can hold a stale handle to
  the DB that global-setup re-seeds.
