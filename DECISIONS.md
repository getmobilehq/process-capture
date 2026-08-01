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

## Phase 5 — Console

- **D5.1 · Auth = bcrypt-at-boot + HMAC cookie** — ADMIN_PASSWORD is bcrypt-hashed
  on first use; a correct password mints an HMAC(sessionkey) cookie (httpOnly,
  sameSite lax, 8h). Login is a native form POST to a route handler that rate-limits
  per IP (10 / 15 min, in-process). Documented as pilot-grade (FR-1.1); SSO is a V1
  non-goal. Why minimal: no external session store; one env var enables/disables the
  whole console.
- **D5.2 · Mutations are server actions, reads are server components** — Create
  project / add interviewee / update finding / raise conflict are `'use server'`
  actions guarded by `requireAdmin()`; the register/findings/conflicts views are
  server components composing `lib/console.ts` read models. Why minimal: no client
  data-fetching, and the same guard covers every mutation.
- **D5.3 · Conflicts are surfaced, never adjudicated** — `buildConflicts` lists any
  facet with rule/metric statements from ≥2 informants, side-by-side and attributed,
  with a numeric-difference pre-highlight; "Raise as finding" creates a
  `candidate_conflict` for a human (P2, FR-1.6). The mock records facet 6 as a
  role-banded `rule` and facet 11 as a `metric` so two informants produce a real
  cross-informant pair.
- **D5.4 · Copy-to-clipboard only, no email** — Invite links are shown with a
  client copy button; nothing is sent (D3 / FR-1.3).

## Phase 6 — Live-model eval loop

- **D6.1 · Personas share ground truth, vary style** — Terse and rambling reuse the
  cooperative fact set with a different informant style, stressing the engine's
  probing and facet-filing on identical ground truth. Why minimal: one well-formed
  fact set exercises all three §9 assertions; three unrelated fact sets add authoring
  surface without testing anything new.
- **D6.2 · A9 fidelity = string-first, model-graded fallback** — Facet fidelity is
  keyword containment first; only items string matching misses go to a judge model
  call. Why minimal: bounds judge cost to the genuinely-ambiguous cases (§9 allows a
  model-graded fallback).
- **D6.3 · Evals run in-memory, per run** — Each run uses a fresh in-memory SQLite
  passed to the engine via its `db` parameter, so runs are isolated and leave no file
  state. Token usage per run is logged (cost guard, §9).
- **D6.4 · Env loading for tsx scripts** — `scripts/load-env.ts` calls
  `process.loadEnvFile('.env')` first, so migrate/seed/eval pick up `.env` the way the
  Next app does (Next auto-loads it; plain tsx does not).
- **D6.5 · Honest-unknown is server-enforced** — Moving a facet to
  `unknown_to_informant` always yields an `unknown_retarget` finding (auto-created if
  the model didn't), deduped per facet. Why: A2 flaked when the model set unknown but
  forgot the paired finding; pairing it server-side (P1) makes the honest-unknown
  guarantee structural, not prompt-dependent.
- **D6.6 · One-question reprompt: up to two attempts** — FR-3.3 specifies reprompting
  *once* then accepting. The rambling persona (designed to stress the rule) tipped A5
  below 95% when a single reprompt didn't take, so the engine now reprompts up to
  twice before accepting + logging. A deliberate strengthening of FR-3.3's mechanism
  to meet the §9 A5 gate; still "reprompt then accept", just one extra attempt.

## Phase 7 — Hardening + pilot pack

- **D7.1 · Non-standalone container** — The Dockerfile is multi-stage but copies the
  full `node_modules` to the runner and migrates via a plain-Node `scripts/migrate.mjs`
  (no tsx at runtime), rather than Next `standalone` output. Why minimal: standalone
  dependency-tracing of a migration entrypoint plus the better-sqlite3 native binary is
  fragile; a larger-but-correct image honours "one deployable" (P6) with less risk.
- **D7.2 · Pilot-grade CSP** — The CSP allows `'unsafe-inline'` (the UI uses inline
  style attributes throughout) and `'unsafe-eval'` (Next dev HMR). Tighten with nonces
  post-pilot. All other security headers (HSTS, X-Frame-Options, nosniff, Referrer-
  Policy, Permissions-Policy) are strict.
- **D7.3 · Rate limiting is per-process in-memory** — Login and the public turn
  endpoint use an in-memory fixed-window limiter; sufficient for a single-instance
  pilot. Swap for a shared store (Redis) only if the deployment scales horizontally.

## V1.1 — Voice input (owner-requested enhancement)

- **DV.1 · Whisper transcription, opt-in and server-side** — Interviewees can answer
  by voice: the browser records audio (MediaRecorder) and posts it to
  `/api/transcribe`, which calls OpenAI Whisper **server-side** (the key never
  reaches the client) and returns text. Enabled only when `OPENAI_API_KEY` is set;
  otherwise the mic button is not shown. **Deviates from the build's "Anthropic API
  only" rule (§10) — a deliberate owner decision.** The privacy notice gains a line
  about third-party transcription (P7); Permissions-Policy allows `microphone=(self)`.
- **DV.2 · Transcript fills the reply box, never auto-sends** — The informant reviews
  and edits the transcription before pressing Send, so what becomes a statement is
  still what they chose to say (P2). `/api/transcribe` is rate-limited (20/min/IP)
  and size-capped (< 24 MB).
- **DV.3 · Voice transcription retries transient connection blips** — `/api/transcribe`
  called `fetch` bare, so undici's default 10s connect budget turned a cold
  connection to `api.openai.com` into a 502 and lost the informant's first voice
  reply (observed: `UND_ERR_CONNECT_TIMEOUT`, then success 2s later). The route now
  mirrors the Anthropic client's posture from `lib/engine/model.ts` — three
  attempts, 400 ms/1200 ms backoff, 60s timeout, retrying network failures plus 429
  and 5xx, but never a 4xx. No new dependency (P6); covered by
  `tests/unit/transcribe-retry.test.ts`.

## Delta v1.1

- **DL.1 · Checklist elements are the unit of coverage (R1.1)** — Each of the 12
  facets gains a typed `elements` checklist in `lib/facets/facets.ts` (40 elements
  total, 3–4 per facet), persisted per session in a new `element_states` table.
  Element ids are stable keys, globally unique (guarded at module load) and
  validated server-side against the facet they claim to belong to.
- **DL.2 · The facet meter is derived, never authored (R1.1)** — `deriveFacetState`
  computes a facet's coverage from its elements: all closed with ≥1 captured →
  `answered`; some closed → `partial`; all ruled out → `not_applicable`. Consequently
  **`set_coverage` no longer accepts `answered` or `partial`** — the model can only
  propose the two honest whole-facet judgements it cannot reach elementwise
  (`unknown_to_informant`, `not_applicable`). This is the direct fix for the pilot
  defect: a facet can no longer be declared complete without the checklist showing it.
  The mock model was updated to close elements rather than declare facets, so the
  golden path exercises the derivation instead of side-stepping it.
- **DL.3 · Captured elements must carry a readback** — `set_element(captured)` is
  rejected without a one-line summary in the informant's own terms. R1.1 requires the
  interviewee to be able to check what the system heard; an empty summary defeats that.
- **DL.4 · Content-based scoring by contrastive calibration (R1.2)** — The system
  prompt gains a scoring section with four natural-language answers that must score
  captured and three keyword-rich but vacuous answers that must stay outstanding,
  plus an explicit instruction that unfamiliar vocabulary is never grounds for
  withholding capture. Prompt-side only; no code branch on wording.
- **DL.5 · Not-applicable is interviewee-driven and always reasoned (R1.3)** — A
  narrow `POST /api/interview/{id}/element` endpoint can *only* mark
  `not_applicable`, so a public caller can never assert something was answered. An
  empty reason cancels rather than closing the element — an unexplained N/A is a
  silent gap by another name (P3). Surfaced inline in the rail, not via
  `window.prompt`: a native dialog blocks the page and cannot carry the VMO2 treatment.
- **DL.6 · Spec front-matter carries element-level coverage (R1.3)** — `coverage`
  gains `elements_captured` / `elements_outstanding` / `elements_not_applicable`, and
  a new `not_applicable_items` key registers each ruled-out element with its facet,
  label and reason. `lib/spec/validate.ts` requires all of them, so a spec cannot
  report a meter without the checklist it was derived from.
