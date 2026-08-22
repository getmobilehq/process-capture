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
- **DL.70 · Demo data comes from the eval loop pointed at the real database** —
  `scripts/demo-interview.ts` runs the same simulated informant and the same engine
  as the §9 harness, but enters through `startSession` — the door the tokenised
  link uses — against the configured Postgres rather than a throwaway pglite. So a
  demo session is structurally identical to one a person sat through, and there is
  no second, diverging way to manufacture a transcript. It asserts nothing: the
  eval harness stays the sole arbiter of quality.
- **DL.71 · A target process is archived, never deleted** — A process architect
  asked to retire processes and reach them again later. Archiving moves the name
  from `target_processes` to `archived_processes` and withdraws the *offer*: no new
  interview can be started against it. Nothing captured is touched — sessions,
  statements and specifications recorded against a retired process stay on the
  register and stay readable, and an informant mid-interview can still resume. A
  hard delete was considered and rejected: an interview is a named person's account
  of their job, and the append-only record is the thing the tool exists to protect.
- **DL.72 · Two arrays with one mutator, rather than a status on each entry** —
  `target_processes` keeps meaning "what may be interviewed against", so every
  existing reader — the entry screen especially — stays correct with no change. The
  alternative, `{name, status}[]`, would need every reader to filter, and a reader
  that forgot would silently offer a retired process to an informant. The cost is an
  invariant across two columns; `moveTargetProcess` owns it in one transaction, and
  a test asserts a name is never in both lists or neither.
- **DL.73 · Retention deletes a whole interview, or none of it** — `RETENTION_DAYS`
  was configurable but nothing acted on it (SDD I-2). A session expires from when it
  finished, or from when it was last touched if it never did, and everything beneath
  it goes with it. Partial retention — keeping the specification but dropping the
  transcript it was drafted from — was rejected: it leaves an attributed document
  whose evidence no longer exists, which is worse than either keeping both or
  keeping neither. An interviewee record goes once they hold no sessions, and that
  is what removes the email address.
- **DL.74 · The sweep reports before it deletes, and the route is absent until armed**
  — `npm run retention` reports by default and deletes only with `--apply`; the
  scheduled endpoint returns 404 unless `RETENTION_TOKEN` is set, and 401 unless it
  matches on a constant-time compare. The first person to run this against real
  interview data must be able to see exactly what it would take before it takes it,
  and a destructive endpoint should not exist at all until someone deliberately
  turns it on.
- **DL.75 · A raw SQL bound is passed as a cast string, not a Date** — the expiry
  comparison sits inside a `coalesce(...)` fragment, so Drizzle has no column type to
  infer and hands the driver a bare `Date`. pglite accepts that; postgres-js does
  not, so the test suite passed while the real database failed. Bounds inside raw
  fragments are now written as `'...'::timestamptz`. The wider lesson is recorded
  here because pglite's permissiveness will hide this class of bug again.
- **DL.76 · Infrastructure moves to Terraform; the runbook stays as narrative** —
  A bash runbook is fine for one deployment by its author and poor for a client's
  cloud team: it cannot be reviewed as a diff, reproduced for a second environment,
  or told what it already created. `infra/terraform` is now the recommended path and
  `DEPLOY-GCP.md` remains as the explanation of what it does. Terraform deliberately
  does not build the image — infrastructure and application releases move at
  different rates, and coupling them makes both harder to reason about.
- **DL.77 · The origin is derived from the request when `BASE_URL` is unset** — The
  platform assigns a URL at create time, so configuring it in advance meant either
  deploying twice or hard-coding a URL nobody had yet. Invite links now take their
  origin from the request the architect is already making, so one apply is enough
  and a custom domain works with no change. An explicit `BASE_URL` still wins, since
  a setting should always beat a guess.
- **DL.78 · The scheduled sweep authenticates on `X-Retention-Token`, not
  `Authorization`** — Cloud Scheduler puts its OIDC token in `Authorization`, which
  is where the endpoint originally looked, so the scheduled call would have arrived
  carrying Google's JWT and been refused. The endpoint now accepts a dedicated
  header for the job and keeps bearer auth for a person at a terminal. OIDC proves
  the caller is the scheduler; the token proves it is allowed. Neither alone would
  do as much.
- **DL.79 · Lane geometry is computed in two passes, because one pass was wrong** —
  Nodes were positioned on a uniform `row × ROW_H` grid while lane bands were drawn
  with variable heights stacked cumulatively. The moment any lane grew past the
  fixed row height, every lane below it drifted out of alignment with its own
  nodes — so activities were drawn in the wrong swimlane, which is not a cosmetic
  fault but a false statement about who does the work. Lane heights are now derived
  from their deepest stack first, and nodes placed inside the band they actually
  belong to.
- **DL.80 · An empty lane is dropped from the diagram** — A lane nobody works in is
  a band of blank space the reader scrolls past; on a real seven-lane graph it
  wasted most of the canvas. The lane list is not the finding — who does the work
  is, and that is in the nodes. Dropped in the layout and, necessarily, in the
  serialiser too: emitting a lane with no DI bounds produces invalid output.
- **DL.81 · Task boxes grow to fit their label** — A fixed 80px box was why long
  activity names spilled over their own borders and over whatever sat beneath them.
  The diagram looked broken when the only thing wrong was the box. Height now
  follows the wrapped line count, capped so one verbose activity cannot dominate.
- **DL.82 · The canvas is editable, and that reverses DL.34** — DL.34 shipped
  viewer-only on the grounds that the graph is extracted evidence, not a drawing
  surface. The reasoning still holds; the conclusion did not survive contact with a
  real nineteen-step process, which lays out four thousand pixels wide and cannot
  be read at any fit-to-screen zoom. The reconciliation: **editing changes the
  drawing, not the evidence.** The arrangement is stored in `diagram_xml` beside
  the graph, never instead of it, so "reset to generated" cannot lose anything an
  informant said. The modeller's palette is hidden — rearranging is the point,
  drawing a new process is not, and a node added by hand would be a claim with no
  provenance.
- **DL.83 · The map exports BPMN 2.0 and SVG from the canvas** — The risk named in
  the request was that architects would leave for a third-party tool. Export makes
  that a choice rather than an escape: BPMN 2.0 XML opens in ARIS, Camunda,
  Signavio and bpmn.io, and SVG drops into a document. A tool people can leave
  freely is one they are more willing to start in.
- **DL.84 · Segments are derived in code; the model only describes them** — Value in
  automation lands on a run of steps, not one step, so R5.8 groups adjacent
  activities sharing a label into segments. That grouping is a union-find over the
  flow graph in `lib/graph/segments.ts`, not a model call: a segment is a claim that
  *these steps, in this order* belong together, which is checkable against the map.
  A grouping a model found persuasive is not. Runs of different labels are never
  merged — where a process alternates the result is several small segments, and that
  fragmentation is itself the finding.
- **DL.85 · The server refuses a verdict the numbers will not carry** — A model that
  has read a process is prone to finding an opportunity in it, and a tool that
  always finds one is a tool nobody should believe. `permittedVerdicts()` computes,
  from the counts alone, which verdicts are defensible: above 40% unjudged only
  `insufficient-evidence` is available, and `strong-candidate` needs both half the
  steps automatable and a single run covering 40%. The model is told the permitted
  set and the server checks it obeyed.
- **DL.86 · The gate stops over-claiming, never under-claiming** — First cut allowed
  `partial-candidate` at 25% automation but not `poor-candidate`, so a correctly
  cautious answer was rejected for being too modest. The two weakest verdicts are
  now always available. A reader is never harmed by being told the opportunity is
  smaller than the arithmetic would permit.
- **DL.87 · The assessment states no cost, saving, headcount or timeline** — There
  is no data for any of them. A number invented here would be quoted back as though
  it had been measured, and the assessment would stop being evidence and start being
  a business case nobody built.
- **DL.88 · Voice-to-text is a provider interface, not an OpenAI call** — Company
  policy asks for Gemini; the pilot is not yet willing to lose Whisper. Both now sit
  behind `lib/transcribe`, chosen by `TRANSCRIBE_PROVIDER`. The Whisper path was
  moved rather than rewritten: its retry posture and extension detection were
  arrived at by fixing real failures (DV.3) and none of that should be lost to a
  refactor. Every result names the provider that produced it, so a switch is never
  silent.
- **DL.89 · Gemini through Vertex AI, not the Gemini API** — Same argument that made
  Bedrock and Vertex right for the base model: access is the platform's own
  identity, so there is no third-party API key to issue, rotate or govern, and the
  audio never leaves the project. On Cloud Run the credentials are the service
  account's, resolved through ADC; the Terraform grants `roles/aiplatform.user` to
  that identity and nothing else changes.
- **DL.90 · Fallback is off by default, and only transient failures qualify** — A
  policy that says "use Gemini" is not satisfied by a system that quietly uses
  OpenAI whenever Gemini has a bad minute. `TRANSCRIBE_FALLBACK` defaults off, so
  the policy holds unless someone deliberately relaxes it. When it is on, only
  transient failures fall back: a safety block or a malformed request would fail
  identically on the other side, so retrying there just sends the audio to a second
  vendor for nothing.
- **DL.91 · Gemini is instructed to transcribe, and its refusals are surfaced** —
  Gemini has no dedicated transcription endpoint, so audio goes to `generateContent`
  with an instruction. That invites two failure modes prose alone would hide: the
  model answering the informant's words instead of writing them down, and a safety
  block returning nothing. The prompt makes transcription the only reasonable
  response at temperature 0, and a block or a truncation is reported rather than
  passed off as silence.
- **DL.92 · Network data sources carry no `depends_on`, and that is not a
  simplification** — A data source with `depends_on` is deferred to apply time
  whenever that dependency has any pending change. `google_compute_network.default`
  depended on the whole `google_project_service.required` map, so merely adding
  `aiplatform.googleapis.com` to that list marked the network "known after apply" —
  which forces replacement of the reserved range, the VPC peering, and, because it
  references the network, **the Cloud SQL instance**. Terraform planned exactly
  that; only `deletion_protection` stopped it. The data sources now read at plan
  time. On a brand-new project where compute is not yet enabled the read fails with
  a clear error, on a project holding nothing — a far better failure than silently
  proposing to destroy a live database.
- **DL.93 · Rate-limit buckets moved to Postgres, resolving SDD I-1** — Limits lived
  in process memory, so `--max-instances=1` was a correctness constraint rather than
  a capacity choice: with N instances the effective limit silently became N × the
  configured value. Buckets are now a table, incremented by a single
  `INSERT … ON CONFLICT DO UPDATE … RETURNING` — atomic in Postgres, so two
  simultaneous requests cannot both read the same count and both decide they are
  under the limit. A table rather than Redis (P6): at interview volumes the row
  count is negligible and a cache tier would be a dependency to operate for nothing.
- **DL.94 · The store fails to in-process counting, never open** — A database blip
  must not let an unauthenticated endpoint spend model credits without limit, and
  must not block an informant mid-interview either. On error the limiter degrades to
  exactly the behaviour this file had before, so the worst case is the old behaviour
  rather than none. It logs at warn, because a sustained run of those means the
  limit is per-instance again and someone should know.
- **DL.95 · The login limiter shares the same buckets** — It guards the console
  password, so per-process counting was the worst of the five call sites: N
  instances gave an attacker N × the attempts with nothing reporting it.
- **DL.96 · `getDb()` is resolved inside the try, not as a default parameter** — As
  a default it threw before the catch could see it, so a missing or malformed
  `DATABASE_URL` took the request down instead of degrading. Found by a unit test
  that had no database configured, which is precisely the condition the fallback
  exists for.
- **DL.97 · Named console accounts, resolving SDD I-3** — Every review was
  attributed to "console admin". That is honest for two people who know each other
  and inadequate the moment someone asks who approved a recommendation about their
  team's job — which becomes a live question at fifteen to twenty informants across
  VMO2. `console_users` holds named accounts with bcrypt hashes; the session cookie
  carries the account id, signed; and `change_reviews` gains `reviewer_id` beside
  the display name. Still not SSO — that remains a V1 non-goal, and a pilot cannot
  wait for an identity integration. This answers "who", which is the question
  governance actually asks.
- **DL.98 · The shared password survives as a bootstrap, not a peer** — Removing
  `ADMIN_PASSWORD` in the same change would lock a running deployment out of its own
  console the moment it shipped, and somebody has to be able to get in to create the
  first account. An email selects the named path; without one the shared credential
  is tried, and those sessions are still labelled "console admin" — the honest label
  for a session nobody is named in. Retire it by unsetting `ADMIN_PASSWORD` once
  accounts exist. Four tests exist solely to prove the shared path still works.
- **DL.99 · A disabled account degrades attribution, it does not break the page** —
  `isValidSession` governs access; `identityFromSession` governs attribution. A
  session whose account was disabled mid-shift resolves to the shared identity
  rather than throwing: the session is already valid and short-lived, and one more
  review labelled "console admin" is a better outcome than a page that fails to
  render. `reviewer_id` is deliberately not a foreign key — a review must stay
  readable after an account is removed, and the display name is the durable record.
- **DL.100 · Accounts are managed by CLI, never by a console screen** — Creating the
  people who may approve recommendations about someone else's job is an
  administrative act. A console page for making console accounts is a privilege
  escalation waiting to be found. Generated passwords are printed once and never
  recoverable; lost means reset, which is the point.
- **DL.101 · Account management runs as a Cloud Run job, because a laptop cannot
  reach the database** — The CLI as first built was `tsx scripts/console-user.ts`,
  which cannot work in production: Cloud SQL has a private address only, and the
  image contained just `migrate.mjs`. A feature nobody can invoke is not a feature.
  A plain-Node twin now ships in the image and runs as a job on the same VPC, so the
  only path to creating an account is from inside the deployment. The alternative —
  a bastion, or a public IP for an administrative errand — would have widened the
  network to save a day's work.
- **DL.102 · The legacy session cookie is deleted, not repaired (security review F1)**
  — It keyed off `config.adminPassword` directly rather than `signingKey()`, so an
  unset `ADMIN_PASSWORD` collapsed the key to the literal `'disabled'` over a
  constant message: a fixed, publicly computable cookie granting a full console
  session. `adminEnabled()` returns true on `SESSION_SECRET` alone, so the
  vulnerable state was precisely the one DL.98's retirement guidance told an
  operator to move to. The affordance existed to spare in-flight sessions one
  re-login; that is not worth an unauthenticated console.
- **DL.103 · `clientIp` reads the last forwarded hop, and there is one of it** —
  Google's front end appends to a client-supplied `X-Forwarded-For`, so the first
  entry is attacker-chosen. Reading it gave anyone a fresh rate-limit bucket per
  request: the console brute-force ceiling never bound, and the only cap on model
  spend was gone. The duplicate copy in the login route — which had the same bug —
  is deleted, because two definitions of "who is calling" is one too many.
- **DL.104 · Two endpoints were serving attributed statements unauthenticated** —
  `/console/sessions/[sessionId]` had no `requireAdmin()` and `/api/spec/[sessionId]`
  had no cookie check, while every sibling route had both. Session ids are
  unguessable but are not secrets: an informant holds their own, and it appears in
  every request path and access log. The E2E test now asserts the unauthenticated
  fetch is refused, so this cannot regress quietly.
- **DL.105 · Disabling an account ends access, rather than anonymising it** —
  `identityFromSession` resolved a disabled user to the shared identity, so
  revocation left them working for the rest of an eight-hour session with their
  verdicts relabelled "console admin". That laundered an offboarded person's
  actions instead of stopping them. `assertSession` now refuses them; a database
  failure still admits a valid signature, because locking every architect out over
  a lookup is the worse failure.
- **DL.106 · The account job never sees a password** — Everything it prints goes to
  Cloud Logging for thirty days, readable by any project viewer, so the generated
  password it printed was a published password — and the comment above it claimed
  the opposite. The operator now generates the password locally and passes only a
  bcrypt hash, which is safe in job arguments and logs.
- **DL.107 · The interview API is bound to the link holder, not the session id** —
  Possession of a session id *was* the permission on all five interview routes. The
  ids are unguessable, but a session id is not treated as a secret: it sits in the
  path of every request the informant makes, so it is in every access log, proxy
  log and support screenshot. What made it urgent was `POST /confirm`, which had no
  auth and no rate limit: one request ended someone's interview, spent a dozen model
  calls, and marked their invite token used — permanently, with nothing in the
  console to re-issue it. A signed httpOnly cookie is now issued when the interview
  starts and required by the routes. The informant's experience is unchanged: they
  arrive through `/i/{token}`, which sets it. Landing on `/interview` without one
  bounces to the entry screen, whose Resume button issues it.
- **DL.108 · `role` is sanitised and `processName` is checked against the campaign** —
  Both are interpolated into the SYSTEM prompt. Sanitising strips line breaks and
  control characters and caps the length; it does not try to detect malicious
  wording, which is unwinnable and unnecessary because P1 already stops the model
  changing state. It removes the one affordance that turns a form field into extra
  instructions — breaking out of the line it sits on. `processName` is now required
  to match the campaign's own list, so the entry screen's dropdown stopped being
  decorative.
- **DL.109 · Emails are redacted by the renderer, not only refused by the validator**
  — The P7 rule is unchanged: no address reaches a specification. But as the only
  defence it was unrecoverable — an informant who said an address aloud had it
  recorded, drafted into a section, then rejected, blocking their completion for
  good with no recourse. Redacting first returns the validator to catching a bug in
  us rather than punishing a person for a sentence.
- **DL.110 · Model annotations are parsed, not cast** — A cast let a malformed
  annotation reach the database, after which the stored graph failed validation on
  every read: map, overlay and assessment all returned 500 permanently for that spec
  version, because a graph is written once and never replaced. Dropping bad entries
  costs an annotation; keeping them cost the whole diagram.
- **DL.111 · Request bodies are refused before they are parsed** — `formData()` and
  `json()` buffer the whole body, so a post-parse cap bounds what is forwarded, not
  what is allocated. Checking `Content-Length` first is not complete — the header
  can lie and a chunked body has none, which is why the post-parse caps stay — but
  it closes the cheap case, which is the one that gets used.
- **DL.112 · Accounts can be created from the console, and DL.100 is reversed with
  its reasoning answered** — DL.100 kept this on the CLI because a page for making
  console accounts is a privilege escalation waiting to be found. That is still
  true: without a guard, a stolen eight-hour session becomes permanent access. Two
  things answer it rather than dismiss it. **Only a named account may create
  accounts** — a session on the shared password cannot, or one shared credential
  becomes a factory for permanent individually-attributed ones, which is worse than
  the problem named accounts solved. And **the acting person re-enters their own
  password**, so a stolen cookie alone is not enough; that is the specific
  escalation a page introduces, so it is the specific thing guarded. The CLI and
  Cloud Run job remain for bootstrap, because someone has to make the first account.
- **DL.113 · A generated password is shown once, in the page, and stored only as a
  hash** — It travels back through the redirect so it renders once and is persisted
  nowhere: not in the database, not in a log, not in an email. The architect's own
  address bar and history hold it briefly, which is acceptable for a value they are
  about to hand over by hand, and the alternative is storing it somewhere.
- **DL.114 · You cannot disable your own account** — Disabling yourself ends your
  session immediately (`assertSession` refuses a disabled account) and, if you are
  the only active account, locks everyone out of account management with no path
  back except the CLI. Refused rather than left to be discovered.
- **DL.115 · Deleting an account is offered, and it is safe for the record** —
  `change_reviews` stores the reviewer's display name, and `reviewer_id` is
  deliberately not a foreign key, so a review keeps its attribution after the
  account is gone. Deleting removes the ability to sign in; it does not rewrite
  what someone approved. Disabling remains the better default for a person who has
  left but whose work may still be queried; deletion is for accounts created in
  error. It asks for the email typed back as well as the acting person's password,
  because it is the one action here with no undo, and the confirmation names what
  is being removed rather than trusting a click.
- **DL.116 · A near-miss domain is queried once, never blocked** — Two accounts were
  created at `@virginmedia.co.uk` by someone who believed they had typed
  `@virginmediao2.co.uk`, and the mistake only surfaced when the colleagues could
  not sign in. Nothing was wrong with the code — the address was saved exactly as
  submitted — but autofill rewrites a field while you are looking at another one.
  The console now compares a new address against the domains already in use and
  asks once, showing both. It does not block: the first account on a new domain is
  legitimate, and a tool that argues with a correct answer trains people to click
  through its warnings. "Looks like a slip" is deliberately narrow — one domain
  contains the other, or they are within three edits — so a genuinely different
  organisation is never queried.
- **DL.117 · The created address is shown as prominently as the password** — Both
  are handed over together and both must be typed exactly, but only the password was
  displayed with any weight. The address was in a heading, easy to skim past while
  concentrating on copying the secret — which is precisely what happened.
- **DL.118 · The backend block is empty and supplied at init time** — A Terraform
  backend cannot take variables, so a hard-coded bucket welds the configuration to
  one project. `envs/<name>.backend.hcl` plus `envs/<name>.tfvars` makes a second
  environment a second pair of small files rather than a second copy of the code.
  Verified by re-initialising the live environment through the new path and planning
  clean against it.
- **DL.119 · The org-policy exception is a template, and carries its own warning** —
  It was welded to one project id, and it is the one artefact that may not be
  grantable in a client's organisation at all: applying it needs org-policy admin
  there, and "make this internet-facing" is a real thing to ask a security team. The
  file now says so, and names the alternative (Identity-Aware Proxy) as a change of
  design rather than a configuration flag — so the question gets asked before a
  migration date is booked rather than during it.
- **DL.120 · Autonomy levels are a separate classification, not a relabelling of
  R5.5** — L0–L3 is a finer instrument than automatable / assistable /
  human-required, and it is deliberately assessed fresh rather than derived.
  "Automatable" does not say whether anyone checks the result afterwards, and that
  is precisely the L3/L2 distinction — the one a stakeholder needs, because it
  decides whether a control disappears or merely moves. The R5.5 rules carry over
  unchanged: no confident level without a cited facet, `unassessed` must say what is
  missing, and the server refuses rather than accepting a plausible answer.
- **DL.121 · L0 is a destination, not a failure** — "human only, by nature or by
  design" is worded that way on purpose. Some work should stay human — an apology, a
  judgement about a person — and a scale that treats every L0 as a gap to be closed
  is one nobody in the business will trust, which makes the whole assessment easier
  to dismiss.
- **DL.122 · The swimlane is hand-rolled SVG, not the BPMN canvas** — Different
  artefact, different reader: one page, printable, for people who will never open
  the tool. Plain SVG prints at any size without rasterising, needs no library (P6),
  and makes the layout a pure function of the data — the same process gives the same
  picture every time, which a diagram in a board pack has to. Each step carries its
  level as text as well as colour, so it survives being printed in black and white.
- **DL.123 · PDF is the browser's print dialogue, not a PDF library** — A print
  stylesheet plus `window.print()` produces a real vector PDF and adds no dependency.
  A client-side PDF library would have added weight to produce something worse.
- **DL.124 · The scale lives in a module with no dependencies** — `autonomy.ts`
  reaches the model, so it imports the Anthropic SDK and the server config. A client
  component importing the level colours from it would have pulled all of that into
  the browser bundle, which is what the build flagged. `autonomy-levels.ts` holds the
  scale and imports nothing.
- **DL.125 · Analysis calls get their own timeout, because the client's is tuned for
  an interview turn** — The shared Anthropic client uses 60 seconds and four
  retries, which is right when an informant is watching a cursor and a fast failure
  beats a long wait. It is wrong for analysis: a change-set call is handed a whole
  specification and a whole graph and takes around 85 seconds to think, so every
  attempt was killed at 60s and the retries consumed the rest. The request failed
  after five minutes having never once been given long enough to succeed — it
  presented as a hang, and it was impatience. `ANALYSIS_REQUEST` is 180 seconds with
  one retry: longer per attempt, fewer attempts, worst case in about the same place.
- **DL.126 · A decision left with one exit is collapsed, not kept** — Removing a step
  can take a whole branch with it; automate the "is the charge correct?" check and
  one arm of the gateway goes. What remained was a diamond with a single exit, which
  is invalid BPMN and, worse, tells a reader a choice is still being made when it is
  not. `applyChangeSet` now rewires past such gateways and drops them, repeated to a
  fixed point because collapsing one can leave its predecessor with a single exit
  too. This was hidden behind the timeout above — the second fault only surfaced once
  the first was fixed.
- **DL.127 · The loading copy says how long to expect** — Analysis takes a minute or
  two on a long process. Silence for that long reads as a hang, which is part of why
  the timeout above was reported as intermittent rather than total.
- **DL.128 · Condition labels are placed by us, not by the renderer** — We emitted a
  `name` on each sequence flow and no label bounds, so bpmn-js placed all eleven at
  their edge midpoints. Where several flows converge on a decision — which is
  precisely where conditions live — they landed on each other and on the boxes
  behind. That is the "text falling on blocks" a reader sees, and no amount of
  panning or zooming fixes it, because the labels really are in the same place. Each
  labelled edge now reserves a rectangle and steps clear of everything already
  reserved, deterministically.
- **DL.129 · The reserved set includes external labels, not just shapes** — Gateways
  and events render their name *below* the shape. Reserving only the diamond meant a
  condition label cleared the diamond and landed squarely on the question it was
  answering. That collision survived the first fix and is why the second was needed.
- **DL.130 · Column gap widened to 120px** — The gap between columns is where
  condition labels live. At 60 there was nowhere for them to go but on top of the
  boxes either side, so the placement above would have had to give up more often
  than not.
- **DL.131 · Fitting stops at a readable scale** — `fit-viewport` on a nineteen-step
  process yields about 0.4: the whole diagram on screen and none of it legible,
  which is what "everything collapses" looks like from the reader's side. Where
  fitting would go below 0.55, the map holds a readable zoom and puts the start of
  the process under the reader instead, so they pan through it rather than squint at
  all of it. Fitting is right when it produces something worth looking at.
- **DL.132 · Badge overlays are scale-clamped** — They are HTML, so without bounds
  they scale linearly with the canvas: illegible at the zoom a long process fits at,
  and dominating the shapes at the zoom you actually read it at. Clamped to
  0.75–1.4 they stay proportionate at both ends.
- **DL.133 · Layout reserves the label space beneath a gateway, the DI does not** —
  A gateway is a 50px diamond whose name renders *below* it, so two stacked
  gateways clearing each other by the row gap still had their questions overlapping.
  Layout now stacks on a footprint that includes the label; the DI still emits a
  square diamond, because a stretched one would be wrong BPMN.
- **DL.134 · Badges scale down with the canvas; only the upper bound is clamped** —
  DL.132 clamped the lower bound at 0.75 on the reasoning that a badge should stay
  legible. Rendered against a real nineteen-step process, that was plainly wrong: it
  fits at about 0.29, so a 22px badge held at 0.75 covered a third of the activity it
  annotated and hid the text underneath — the badges became the diagram. A badge is
  an annotation, not a label: at a zoom where the step cannot be read there is
  nothing to annotate, and a small dot saying "something is here" is the right amount
  of presence. Recorded because the first version was reasoned rather than looked at,
  and looking at it took one render.
- **DL.135 · Condition labels are shortened for the diagram, not for the record** —
  Extracted conditions read like sentences — "Credit £500–£2,000 — Operations Manager
  pathway" — because that is how a person describes a rule out loud. As BPMN edge
  labels they are wrong: labels there are conventionally two or three words, the
  branch rather than the reasoning. Three fifty-character conditions leaving one
  gateway collide however carefully they are placed, because there is genuinely not
  room. The label now carries the discriminator ("Credit £500–£2,000", "Yes", "No")
  and the full text stays in the graph for the evidence panel and the export.
  Splitting on the em-dash is not a guess — it is how the extractor phrases them,
  "answer — because".
- **DL.136 · Label boxes are measured from their text, and the estimate errs narrow**
  — A fixed one-line reservation meant every wrapped label overlapped by three times
  its own height. Height now follows the character count at twelve per line, which is
  narrower than the bounds imply: the renderer wraps tighter than the box suggests,
  so a label measured as one line arrives as two and sits on its neighbour.
  Under-estimating costs a little empty space, over-estimating costs a collision.
- **DL.137 · Boot migrations take an advisory lock, resolving the contradiction
  DL.93 introduced** — Raising `max_instances` from 1 to 3 made concurrent boot
  migrations possible, and Drizzle's migrator takes no lock of its own. This was not
  theoretical: five migrators against an empty database produced one success and
  four duplicate-key failures. A Postgres advisory lock serialises them — whoever
  arrives first migrates, the rest wait and find nothing to do. A lock rather than a
  one-shot job, because a job must be sequenced ahead of every deploy by whatever
  runs the deploy, and a step that must be remembered is a step that will eventually
  be forgotten. `lock_timeout` is bounded so a lock left by a killed container
  cannot hang every boot that follows, and a timeout fails the start rather than
  proceeding: a server without its schema serves 500s and reads like an application
  bug.
- **DL.138 · An uptime check, because probes tell Cloud Run and not a person** —
  Startup and liveness probes restart a container; they notify nobody. With
  interviews running twenty-five to forty minutes, the realistic failure is silence:
  the service is down, an informant gives up, and it surfaces when someone asks how
  the pilot went. The check polls `/health` from three regions and alerts after two
  consecutive failures rather than one — an alert that cries wolf is an alert people
  stop reading. Alerting is off unless `alert_email` is set, so a deployment without
  it still works and simply tells nobody.
- **DL.139 · An unconfirmed entity stays inside the interview that named it** —
  Free text at a pick-list facet creates a `pending` entity on the project, and the
  pick-list is rendered into every other informant's system prompt. So one person's
  unreviewed sentence was reaching another person's interview as text the model
  reads — a write path between informants that P2 does not contemplate and nobody
  approved. `picklistOptions` now shows an entity to other sessions only once it is
  `confirmed` or came from the taxonomy; the informant who typed it still sees their
  own. Names are also sanitised on the way in, the same treatment `role` already
  had: a line break is what turns a name into an instruction.
- **DL.140 · Every cookie-authenticated POST checks where it came from** — Cookies
  authenticate the console and, since DL.107, the informant; a cookie is attached by
  the browser whoever caused the request, so another site's form could act as the
  signed-in person. `SameSite=lax` covers most of it and login none of it — an
  attacker can force a victim into *their* account and read what gets typed. The
  routes now compare `Origin` (falling back to `Referer`, which our
  `strict-origin-when-cross-origin` policy still sends same-origin) against
  `x-forwarded-host`. It fails closed. The retention sweep deliberately does not
  call it: a header token cannot be attached cross-site, so it is not forgeable.
- **DL.141 · An unrecognised exception is logged, not returned** — Six routes
  returned `(err as Error).message` to the caller. Those messages are written for us
  and carry our internals: connection strings, file paths, SDK account identifiers.
  `serverError()` logs the exception and answers with a sentence. Routes' own domain
  errors are unchanged — they are written to be read by the person who caused them.
  The `DATABASE_URL` guard now names only the scheme for the same reason: the one
  URL it can print is the one that failed the check, and it may hold a password.
- **DL.142 · A failed sign-in costs the same whether or not the account exists** —
  bcrypt is deliberately slow, so skipping it for an unknown address made "no such
  account" and "wrong password" distinguishable with a stopwatch, and the register is
  a list of named colleagues. An unknown address is now compared against a decoy hash
  at the same cost.
- **DL.143 · An entity id arriving over HTTP is a claim, not a fact** — The tick
  endpoint took `entityId` on trust, so a crafted request could file a mention against
  a row from another campaign entirely — one client's interview linked to another
  client's vocabulary, a P7 failure before anything else. `getEntityInProject` checks
  the project and the kind the facet asked for.
- **DL.144 · CSP with a per-request nonce, replacing `unsafe-inline`** — `script-src
  'self' 'unsafe-inline'` is very nearly no script policy at all: stopping injected
  markup from executing is the entire point. It was there because Next emits inline
  bootstrap scripts. `middleware.ts` mints a nonce per request and sets the policy on
  both the request and response headers, which is how Next knows to stamp its own
  scripts; `strict-dynamic` covers the chunks those scripts load. `unsafe-eval` is
  now development-only (dev HMR needs it). `style-src` keeps `unsafe-inline`: inline
  style *attributes* are used throughout for coverage colours and lane geometry,
  cannot be nonced individually, and cannot execute. Verified against a production
  build — hydration, sign-in, and the bpmn-js canvas all render with no violations.
