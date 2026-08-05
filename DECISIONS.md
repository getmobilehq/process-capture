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
- **DL.7 · Four facets are pick-lists, eight stay open (R2.1)** — Closed sets in
  practice: stakeholders (2), triggers (3), inputs/outputs (4), systems (8). The
  open facets are where tacit knowledge lives — workflow, rules, exceptions,
  bottlenecks — and are never reduced to a tick-list. `elicitation` and `entityKind`
  live on the facet spec, so the classification has one home.
- **DL.8 · Entities are canonical, project-scoped and status-tracked (R2.2/R2.3)** —
  New `entities` + `entity_mentions` tables. `canonicalKey` folds case, spacing and
  punctuation ("Remedy/Helix" = "remedy helix"), so cross-interview analysis matches
  on identity rather than prose. Taxonomy entities are seeded `confirmed` per
  project from the VMO2 estate; anything an informant names arrives `pending`,
  awaiting admin confirmation before it joins the house vocabulary.
- **DL.9 · Every option carries its source, and a colleague's answer is labelled as
  one (R2.2)** — Options are seeded taxonomy → this interview → prior interviews,
  and the UI and prompt both show which. The model is instructed never to present a
  colleague's answer as fact ("some of your colleagues mentioned X — does that apply
  to you?"), because attributing is the whole point (P2).
- **DL.10 · Ticking is additive; there is no untick** — A mention records that the
  informant said something, and evidence is not walked backwards (P2). A correction
  is a matter for the conversation, not a checkbox. "Something else — let me describe
  it" is always present and styled co-equal, so the list never becomes a cage.
- **DL.11 · Drafts are append-and-archive; nothing is hard-deleted (R10.3)** — New
  `answer_drafts` table with `active | discarded | archived | submitted`. Autosave
  upserts the live row (~1.2 s behind typing, plus on every state change and on
  `beforeunload`). Discard soft-deletes and Undo restores byte-identically for the
  rest of the session; a re-record archives the prior take rather than overwriting
  it. Hard deletion only at engagement decommission. Tested as a guarantee: the
  suite asserts what *cannot* happen, not just what can.
- **DL.12 · Destructive controls are separated from Submit (R10.3)** — Discard and
  Re-record live on their own row below the composer, never adjacent to the primary
  action, and both require an explicit confirmation that states what is at stake
  ("Discard 43 words?"). Submit is the only primary button.
- **DL.13 · Recording state is stated in words, not just colour (R10.1)** — Three
  visually distinct states (idle Record / red Stop / amber Paused), each with icon
  *and* word, a pulsing indicator and an elapsed timer. Never icon-only: a mic glyph
  alone does not tell someone whether they are being captured.
- **DL.14 · Voice transcription is chunked, not truly live (R10.2 — deviation)** —
  R10.2 asks for transcription streaming into view as the user speaks. Whisper is a
  batch endpoint with no streaming interface, so text lands when the informant
  stops, not while they talk. Pause/Resume and the elapsed timer give feedback
  during capture, and the result is presented as an editable draft as specified.
  **True live transcription needs a streaming ASR** (e.g. a realtime speech API) —
  a provider decision, so flagged rather than assumed.
- **DL.15 · One ranking module, shared by R9.2 and R4.2** — `lib/engine/priority.ts`
  is the single ranking authority, as the delta requires. Tiers: conflicting →
  mandatory-core (facets 1, 3, 5, 6 — identity, triggers, workflow, rules) →
  nearly-complete (one element from closing) → everything else. Budget exhaustion
  therefore truncates from the least important end. The `conflicting` tier is wired
  but empty until R3 lands artefact provenance.
- **DL.16 · Finishing early is a first-class path, not an error (R9.3)** —
  `completeInterview` now accepts an `open` session, so "Finish recording" works at
  any point. Every element not reached is written to `open_items` naming its facet,
  which is the seed list for follow-up sessions.
- **DL.17 · Truncated specs state their gaps in the prose, not only the
  front-matter (R9.4)** — Each facet section with outstanding elements ends with an
  explicit "Not covered in this interview: …" line, and a partial facet with no
  statements says so rather than having prose drafted from nothing. A reader of the
  body alone cannot mistake a partial account for a complete one.
- **DL.18 · The budget is counted in questions asked, not answers captured (R9.5)** —
  So a chip-accepted answer (R8) costs less of the informant's time without gaming
  the counter; suggestions stretch what a budget captures rather than inflating it.
- **DL.19 · The question phase is handed a ranked shortlist (R4.2)** — Instead of
  leaving the model to pick, the engine passes the top two candidates from
  `priority.ts`, each citing what prompted it. At most two per turn, so the
  interview reads as a competent listener rather than a questionnaire.
- **DL.20 · The ledger is a projection, not a second source of truth (R4.3)** —
  `lib/engine/ledger.ts` derives every claim from the append-only statements, the
  element checklist and the entity mentions, so it cannot drift from the record it
  describes (P1). Superseded statements are excluded, so the ledger reflects what
  the informant settled on (P2). Follow-up generation reads this block, never the
  raw transcript, which is what makes "never ask twice" structural rather than a
  prompt instruction. The `documented` / `corroborated` / `conflicting` provenance
  classes are declared now so the ledger's shape does not change when R3 lands.
- **DL.21 · The process graph is the canonical artefact, and lineage is mandatory
  (R5.1)** — `lib/graph/schema.ts` types the graph in Zod; `lib/graph/validate.ts`
  enforces the structural rules (exactly one start, ≥1 end, no orphans, resolvable
  flows and lanes, every gateway forks at least twice, boundary events attached).
  `sourceFacet` is required on every node and annotation: a diagram element with no
  facet lineage is invalid, because a diagram that cannot say where a box came from
  is decoration, not evidence. A corrupted graph fails loudly with named errors
  rather than rendering something plausible (R5.7).
- **DL.22 · A to-be change must resolve an evidenced bottleneck (R5.4)** — Enforced
  in two places: the Zod shape requires at least one `resolvesAnnotationId`, and
  validation requires each id to name an annotation that actually exists on the base
  graph. A to-be diagram is a set of answers to evidenced problems, not a wishlist.
  `verified` defaults to false and is never set by the generator — approval is a
  human act.
- **DL.23 · No opportunity label without cited evidence (R5.5)** — A confident label
  (`automatable` / `assistable` / `human-required`) with an empty evidence array is
  rejected; `unclassified` is the honest outcome when evidence is thin and must
  still explain itself.
- **DL.24 · Cumulative elements need every rung, not the first (R1.2 correction)** —
  The first live-model eval after R1 failed A3 twice (`missing: 500`, then
  `missing: 100,500`). V1's facet rubric said "probe to £ bands and governance
  tiers"; the R1 element rubric said thresholds are captured when "concrete
  thresholds are given", which one figure satisfies — so the model closed
  `rules.thresholds` after the first number and stopped climbing. The rubric now
  requires every band up to the top of the ladder, and the scoring section carries a
  worked example of the partial-ladder mistake. **Generalisable lesson: an element
  whose answer is a list needs a rubric that says so, or the checklist trades
  vocabulary-sensitivity for premature closure.**
- **DL.25 · Magpie identity layer sits on top of the VMO2 tokens, not in place of
  them** — `public/brand/magpie.css` loads after `colors_and_type.css` and overrides
  only brand and surface tokens. The spacing scale, radii, type scale and motion are
  deliberately untouched: the layout's white space is the part of the VMO2 system
  that already worked, and a rebrand is no reason to compress it. Page background
  moves to `#FAF8FB` (faintly purple) with cards staying `#FFFFFF`, which is the
  brand system's own light map.
- **DL.26 · Purple is identity, blue is interaction** — Magpie purple `#712D85`
  carries the mark, lockup, capsules and brand callouts; every interactive control
  stays O2 Blue `#0050FF`, exactly as the brand system specifies. Colour therefore
  never tells someone a thing is clickable when it is not. Coverage-rail state
  colours (green/yellow/pink/grey) are semantic, not brand, and are unchanged.
- **DL.27 · Dark mode is documented but not auto-enabled (deviation)** — The brand
  system's dark map is implemented under `:root[data-theme="dark"]`, *not*
  `prefers-color-scheme`. Binding it to the media query was tried and reverted: the
  component layer still uses fixed ink tokens (`--ink-900` on inputs, white pill
  text) that do not flip with the surfaces, producing dark text on dark fields.
  Enabling it properly means flipping the ink ramp through `brand-ui.css` — separate
  work, deliberately not smuggled into a rebrand.
- **DL.28 · Layered layout rolled rather than pulled in elkjs (R5.2)** — The delta
  suggests elkjs with an "e.g.", not as a requirement. A left-to-right layered
  layout over a graph of this shape is about eighty lines, and rolling it keeps
  `toBpmnXml` a **pure synchronous function**: elkjs is async, which would make the
  serialiser, the round-trip test and the export route all promise-based for no
  gain, and adds ~1 MB to the bundle. P6 says extend before adding. If layout
  quality later proves insufficient for large graphs, elkjs remains a drop-in for
  `layoutGraph` alone — the seam is deliberate.
- **DL.29 · Graph ids are sanitised on the way into XML (R5.2)** — Our ids carry a
  readable kind prefix (`act:diagnose`), but a colon is a namespace separator in
  XML, so an unsanitised id produces a document no BPMN tool will open — the exact
  failure that would break the ARIS path silently. `xmlId` maps to a valid NCName;
  the round-trip test asserts through the mapping rather than around it.
- **DL.30 · Annotations are excluded from the export by default (R5.2/R5.3)** —
  Bottleneck, risk and metric annotations render as in-app overlays where they can
  carry their facet citation and evidence panel. Baking them into the exported XML
  as text annotations is available behind `includeAnnotations`, but off by default
  so the ARIS import is process semantics rather than commentary.
- **DL.31 · The extractor forces the tool and stamps provenance server-side (R5.1)** —
  `tool_choice` pins `emit_process_graph`, so a prose reply is a failure rather than
  something to parse. `specRef` and `generatedAt` are applied by the server after
  the call and override anything proposed: the model does not get to assert which
  spec a graph came from or when (P4). Invalid proposals are returned with their
  named validation errors and retried once, then the extraction fails loudly —
  R5.7's requirement that a corrupted spec never yields a silent bad graph.
- **DL.32 · The retry refuses to trade honesty for validity** — The correction
  message tells the model explicitly not to invent steps to satisfy a structural
  rule: if the specification genuinely lacks an end state or a second branch, the
  right outcome is a failed extraction, not a graph padded until it validates. A
  diagram that passes because material was fabricated is worse than no diagram.
- **DL.33 · bpmn-js earns its dependency; elkjs did not (R5.3, P6)** — Rendering
  BPMN correctly means the full notation vocabulary, swimlane bands, edge routing,
  pan and zoom, and an overlay system anchored to elements through both. That is
  not eighty lines like the layout was, and hand-rolling it would produce a worse
  diagram that a modeller would not trust. Loaded via dynamic `import()` so the
  bundle only pays for it on the map view. Its CSS is bundled rather than fetched
  from a CDN — the CSP blocks external hosts and the map must render offline.
- **DL.34 · Viewer mode, never the modeller (R5.3)** — `NavigatedViewer`, so the
  diagram pans and zooms but cannot be edited. The graph is extracted evidence,
  not a drawing surface: letting someone drag a box would produce a diagram that
  no longer matches the spec it claims to render, with nothing recording the
  divergence. Changes belong in the to-be change-set (R5.4), where every one must
  cite the bottleneck it resolves.
- **DL.35 · Annotations are overlays, not BPMN text annotations (R5.3)** — Baking
  them into the diagram would clutter it and lose the citation. As overlay badges
  pinned to their target element they travel with pan and zoom, keep the diagram
  legible, and put the facet citation one tap away in the evidence panel — which is
  what R5.3 asks for.
- **DL.36 · The map is drawn on request, not on load (R5.6)** — Extraction is a
  live model call, so opening a spec must not silently spend one. The Process map
  tab triggers a POST (not a GET — it is not a cheap idempotent read and nothing
  should prefetch it), and the graph route is console-authenticated: the map is
  analysis for the architecture team, not something the informant is shown.
- **DL.37 · Unbuilt sub-views are shown disabled, not hidden (R5.6)** — The delta
  specifies three sub-views. To-be and Opportunities render as disabled tabs so the
  shape of what is coming is visible and their absence is legible, rather than the
  page quietly implying the map is all there is.
- **DL.38 · Graph persistence — RESOLVED (see DL.49)** — Originally deferred; the
  `process_graphs` table now stores a graph per (session, spec version, kind).
- **DL.39 · The generator is offered only the evidenced bottlenecks (R5.4)** — The
  prompt carries the annotations and the flow, and says "these, and only these, are
  what a change may resolve". Nothing else about the process is offered as raw
  material, because the failure mode to design against is a plausible improvement
  attached to a bottleneck it does not actually address.
- **DL.40 · No evidence means an empty set, and no model call** — A graph with no
  annotations returns `{ changes: [] }` without calling the model at all. Inviting
  a model to propose improvements for a process with no evidenced problems is
  inviting it to invent one.
- **DL.41 · The retry tells the model to return fewer changes** — When validation
  fails, the correction explicitly says not to attach a change to an unrelated
  annotation to get it through, and that returning fewer changes is a correct
  answer. Without that, the cheapest way to satisfy "every change resolves a
  bottleneck" is to mislabel, which would defeat the constraint while passing it.
- **DL.42 · `verified` is false by construction (R5.4 gate)** — The server stamps
  `provenance: 'proposed'` and `verified: false` after the call, overriding anything
  proposed. The generator cannot mark its own work verified; only a human reviewer
  can, and that path is not built yet.
- **DL.43 · Placement is structured, because prose is not a position (R5.4)** — The
  delta's `Change` shape carries where a change goes only in the description
  ("insert between diagnostics and the next-best-action decision"). A mechanical
  apply cannot act on a sentence, so `placement { after, before, laneId, name }` is
  added alongside it and the generator is told to supply it for `add` and
  `reorder`. The description stays — it is what a human reads — but the diagram is
  built from the structure.
- **DL.44 · The to-be graph is derived, never authored** — `applyChangeSet` is pure
  and deterministic and never mutates the as-is graph, so the to-be cannot drift
  from what the change-set says. `changedIds` and `changeByNode` are returned
  *alongside* the graph rather than flagged inside it, keeping the result a plain
  `ProcessGraph` that `validateGraph` still applies to, and letting a change badge
  name the bottleneck it resolves (Appendix A, point 4).
- **DL.45 · An invalid to-be is a failure, not a diagram with a caveat** — Applying
  a change-set re-runs `validateGraph` and throws if the result is incoherent.
  Removing the start event, say, does not produce a diagram rendered with a warning
  — it produces nothing, for the same reason a corrupted spec produces no map.
- **DL.46 · Skipped changes are reported, never silently dropped** — A change that
  cannot be applied (no usable placement, a target that is not there) comes back in
  `skipped` with its reason. A to-be diagram missing a change the reviewer was told
  about is worse than one that says which change it could not place.
- **DL.47 · The to-be is generated against the graph on screen, not a fresh
  extraction (R5.4)** — The to-be route takes the as-is graph in the request body.
  Re-extracting would risk proposing changes against a different graph than the one
  the reviewer is looking at, since extraction is not deterministic. Once graphs are
  persisted (DL.38) this should take a graph id instead — the body is a stand-in for
  the missing persistence, not the intended shape.
- **DL.48 · Provenance styling is structural, per Appendix A point 3** — Changed
  elements get a bpmn-js marker driving a dashed, tinted treatment, plus a badge
  naming the bottleneck the change resolves. A legend states both states in words.
  A reader can tell changed from unchanged before reading a label, which is what the
  reference renderings make normative.
- **DL.49 · Graphs are stored per spec version, and never silently replaced** —
  New `process_graphs` table keyed by (session, spec version, kind). Extraction and
  change-set generation are live model calls and are not deterministic, so
  regenerating per view would leave two reviewers looking at different diagrams of
  the same specification — and would orphan any change-set keyed to the older
  graph. `saveProcessGraph` therefore returns the existing row rather than
  upserting: replacing a graph is an explicit act (`?refresh=1`), never a side
  effect of viewing. Refreshing an as-is graph also discards its to-be, because a
  change-set is only meaningful against the graph it was proposed for.
- **DL.50 · The to-be reads the as-is from the store, not the request (supersedes
  DL.47)** — With persistence landed, the to-be route no longer accepts a graph
  over the wire. A change-set is only meaningful against the exact graph it was
  proposed for, and accepting one from a client would let changes be keyed to a
  graph nobody else can see. Both the change-set and the derived graph are
  persisted, so a reviewer returns to the same proposal they left rather than a
  freshly generated one.
- **DL.51 · Annotations are a second, dedicated extraction pass** — Found by running
  the chain against a real spec (`spec-fraud-resolution-v1.md`, 12/12 facets
  answered). A single call asked for both structure and evidence returned a **valid
  graph with zero annotations**, against a specification whose facet 12 described
  four separate bottlenecks in detail. A direct probe confirmed the model reads them
  easily when that is its only job — it was spending its attention satisfying the
  structural rules and treating annotations as an afterthought. Splitting them into
  `extractAnnotations`, run after the node list is fixed, took the same spec from
  0 to 14 annotations and from 0 to 3 generated changes. One concern per call.
  The annotation pass is non-fatal: the structure is the more valuable artefact, so
  a failure there returns an empty array rather than losing the graph, and an
  annotation aimed at a node that does not exist is dropped rather than left to
  dangle at render time.
- **DL.52 · A proposed lane id is a suggestion, not a fact** — Found rendering the
  real fraud spec: the change-set generator named `lane:agent` from the
  specification's language while extraction had chosen different lane ids, and
  `applyChangeSet` trusted it — throwing away the entire to-be over a bad
  reference. An unknown lane now falls back to the anchor node's own lane. The
  generator writes in the informant's vocabulary; only the graph knows its ids.
- **DL.53 · Extraction is a reading, not the reading** — Two runs over the same
  specification produced 23 activities/13 annotations and 15 activities/14
  annotations. Both valid, both faithful, neither canonical. This is inherent to a
  model-driven extraction and is exactly why graphs are persisted (DL.49) rather
  than regenerated per view — but it means a reviewer is approving *a* reading of
  the spec, and the pilot should say so rather than implying the diagram is derived
  mechanically.
- **DL.54 · The specification is rendered, not dumped — and still downloads as .md**
  — Feedback from reviewing a real spec on screen. The frontmatter becomes a
  provenance panel with coverage stats and open items surfaced first; facets get
  numbered headings and a state chip; prose sets at 72ch. The markdown parser is
  ours rather than a library (P6): the renderer in `lib/spec/render.ts` writes
  every line this ever sees, so the subset is known — and building React elements
  rather than HTML means an informant's stray angle bracket can never become
  markup. The `.md` download is unchanged and remains the artefact to hand on.
- **DL.55 · The map expands to full screen, on the stage rather than the page** —
  A 15-lane diagram in a 520px box is not readable. Zoom, fit and full-screen
  controls sit on the canvas; full screen targets the stage element so the diagram
  gets the whole viewport, and refits after the transition — otherwise it sits tiny
  in the middle of a large empty rectangle. If the Fullscreen API is refused
  (permissions policy, embedded contexts) it falls back to a fixed-position
  expansion, so the control always does something.
- **DL.56 · The to-be map ships disabled (`ENABLE_TOBE`)** *(superseded in part by
  DL.62 — the verification gate now exists, so this flag is a deployment choice
  rather than a safety net)* — R5.4's human
  verification gate is not built: nothing yet stops an unreviewed,
  machine-generated change-set reaching a handover report, and the delta locks
  that decision. Off by default, and gated in **two** places — the tab renders
  disabled with a tooltip saying why, and the route itself returns 404. Hiding a
  tab does not stop a POST, and on a deployed URL the difference matters. Remove
  the flag when the gate lands, not before.
- **DL.57 · The pilot runs on exactly one instance, for correctness not capacity** —
  `lib/rate-limit.ts` keeps its buckets in a per-process Map, so with N instances
  every limit silently becomes N × its intended value — and nothing reports it.
  Cloud Run is therefore pinned `--min-instances=1 --max-instances=1`: one instance
  makes the limiter correct, removes cold starts in front of a waiting informant,
  and costs a few pounds a month. Interviews are not concurrent at pilot scale, so
  nothing is given up. **Raising max-instances without first moving the buckets
  into a table is a silent regression** — the note now sits in the file itself, not
  only in the deployment plan.
- **DL.58 · An honest unknown may override derived coverage** — `answered →
  unknown_to_informant` is now a legal transition. Since R1 (DL.2) the model cannot
  declare a facet answered; that state is *derived* from the checklist. So a facet
  can reach `answered` because elements were closed from adjacent material while
  the informant's real position is "that isn't mine to answer". Found by the live
  eval: a rambling informant produced facet 9 = `answered` **with a retarget
  finding already raised** — the finding landed, the coverage correction was
  rejected as an illegal transition, and the spec claimed knowledge nobody had.
  That is a P3 violation ("no silent gaps") arriving from the opposite direction to
  the one R1 was built to close. The reverse transition stays illegal, so this
  remains a one-way door and terminal states are still immutable in the direction
  that matters.
- **DL.59 · The E2E server builds to its own directory (`NEXT_DIST_DIR`)** — A
  `next build`, or a second `next dev`, sharing `.next` with a running dev server
  overwrites the chunks that server has open. It does not crash: it stays up,
  serves 500s, then connection-refused, and writes no error to its own log — only
  a `[?25h` on shutdown, which reads like a clean exit. Diagnosed by reproducing
  it: healthy server → `npm run build` → same PID alive → `/health` 500. The
  Playwright webServer now sets `NEXT_DIST_DIR=.next-e2e`, so the suite and a dev
  server coexist in one working tree.
- **DL.60 · The spec detail page carries breadcrumbs** — It is only reachable from
  a campaign register and previously dead-ended there, with no way back but the
  browser button. Campaigns / campaign / process, with the middle crumb returning
  to `?tab=register` so the reader lands on the list they came from.
- **DL.61 · The container migrates itself at boot, and refuses to start if it
  cannot** — `scripts/migrate.mjs` was still SQLite after the Postgres migration,
  and the Dockerfile runs it before `next start`. Caught during the merge; it would
  have failed the first Cloud Run deployment. Rewritten for postgres-js, with two
  properties that matter: no `DATABASE_URL` is a hard exit rather than a silent
  fallback to a local file, and a failed migration exits non-zero rather than
  starting a server with no tables — which serves 500s on every request and reads
  like an application bug. Safe at one instance (DL.57); if max-instances is ever
  raised, this must become a one-shot Job or two containers will race.
- **DL.62 · The verification gate is per change, and it refuses (R5.4)** — New
  `change_reviews` table holding verdict, reviewer and timestamp **per change**,
  because approving four proposals and rejecting a fifth is the normal outcome and
  a set-level flag cannot express it. `lib/graph/verification.ts` is the single
  authority on what "verified" means, so the UI and the export path cannot
  disagree. A set is verified only when *every* change has been ruled on; rejected
  changes leave the diagram but stay on the record. There is deliberately **no
  "approve all"** — one button would turn the gate into a formality.
  The to-be export is disabled *and* the handler refuses: a disabled control is a
  hint, and a gate has to be a rule.
- **DL.63 · A reviewer may reword a change, never re-aim it** — An edit replaces
  the description and rationale and keeps the original alongside; it cannot touch
  `resolvesAnnotationId`. Re-pointing a change at a different bottleneck is a
  different change, and letting it happen silently under "edit" would break the
  evidence chain R5.4 exists to protect. Edits, notes and verdicts are exposed as
  `evalSignal()` — what was proposed, what the human made of it, and why — which is
  the feedback the generator needs and the delta asks to be logged.
- **DL.64 · Reviewer identity is honest about its limits** — The console is one
  shared password, so reviews are attributed to `console admin`. That is the true
  attribution available today rather than an invented name. Real per-reviewer
  identity needs user accounts; the column is there and the shape does not change
  when they arrive.
- **DL.65 · Opportunity labels go through the R5.4 gate, not beside it** — "this
  step could be automated" is a claim about someone's job, so it is held to the
  same standard as a to-be change: proposed and unverified until a person has ruled
  on every label. Rather than a second review mechanism, the classification set is
  presented to `verificationState()` as an indexed list, so one gate governs both
  and they cannot drift apart.
- **DL.66 · A confident label without cited evidence is rejected by the server** —
  `automatable`, `assistable` and `human-required` each require at least one facet
  citation; only `unclassified` may cite nothing, and it must say what is missing.
  The retry prompt tells the model to downgrade rather than invent a citation,
  because an honest "we do not know whether this system has an API" is actionable
  to a modeller and a wrong confident label is worse than none.
- **DL.67 · The overlay marks activities with letters, not colour alone** — A, ½
  and H sit on the badge. The as-is map already spends colour on the coverage
  states, and an automation judgement a reviewer cannot read without distinguishing
  hues is not a judgement they can check.
- **DL.68 · A non-Postgres `DATABASE_URL` is refused at the connection, and has no
  default** — A leftover `file:./data/app.db` did not fail as a bad URL: postgres-js
  read the path as a database name and asked the server for a database called
  `data/app.db`, so a stale env line surfaced as an unreadable `3D000` on every
  console page. `getSql` now rejects anything that is not a `postgres://` URL and
  says what to use instead, and `config.databaseUrl` no longer carries the SQLite
  default that let the stale value pass unnoticed. There is no sensible default for
  a database server address; absent configuration should say so.
- **DL.69 · tsx scripts load `.env` explicitly** — Next loads `.env` for the app but
  not for `tsx scripts/*`, so `seed` and `db:migrate` were reading an empty
  `DATABASE_URL` and silently falling back to the old SQLite default. With the
  default gone (DL.68) they failed loudly, which is the correct behaviour and made
  the missing loader visible; both now import `./load-env` first, as `eval.ts`
  already did.
