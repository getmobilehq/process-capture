# Process capture — SME interview tool · V1 build requirements

**Purpose of this document** — a complete, self-sufficient build brief for hands-off execution by Claude Code. It contains everything needed to build, test, and self-verify the product in an autonomous loop: product context, locked decisions, architecture, data model, behavioural specification, phased build plan with verifiable gates, and the evaluation harness that closes the loop. Where this document is silent, prefer the simplest implementation consistent with §2 principles, record the decision in `DECISIONS.md`, and continue — do not stop to ask unless a gate genuinely cannot be passed.

**Reference artefacts** (place in `/reference` before starting; treat as read-only):
- `process-capture-demo.html` — the approved interactive demo. **This is the UX and visual reference.** The built product must reproduce its golden path, layout intent, and brand execution.
- `SME-interview-tool-V1-spec.docx` — the product specification this document operationalises.
- `VMO2_Design_System/` — the extracted brand ZIP: `colors_and_type.css` (all tokens), `fonts/` (Aeonik Pro woff), `assets/logos/`. Copy tokens and fonts into the app; do not restyle or approximate.

**Version** 1.0 · 17 July 2026 · Owner: Joseph · Consumers: Claude Code (builder), Paul (reviewer)

---

## 1. Product context (read once, then build)

VMO2's processes are substantially tacit — held in the heads of process users, undocumented or stale in ARIS. This tool captures that knowledge through a structured conversational interview and produces an attributed, provenance-tagged Markdown process specification per informant, per process, ready for a modeller to draft into ARIS. It is the human "why" layer of the wider BPR pipeline.

The product has two faces:
1. **Process user** — receives a link (distributed manually), self-identifies, is interviewed by an agent against the 12 process facets, reviews a playback, and is done in 25–40 minutes.
2. **Process architect** — creates campaigns (projects), issues links, watches the interview register fill, receives generated specifications and findings.

Everything the tool captures is **stated** knowledge. Provenance is carried on every output so that stated-versus-actual comparison is possible when evidence-based discovery (document/process mining) comes online later. That comparison is out of scope for V1; carrying the provenance is not.

## 2. Non-negotiable principles

These resolve design arguments in advance. Violating one is a defect.

- **P1 — The model proposes; the server disposes.** Coverage state, session state, and the specification schema are owned by deterministic server code. The model proposes coverage updates and content via tool calls; the server validates and applies. The model never directly mutates state or free-writes the spec structure.
- **P2 — Attribute everything; average nothing.** Every statement is stored against its informant. Conflicting statements are surfaced as findings for a human; they are never merged, averaged, or silently overwritten.
- **P3 — No silent gaps.** Every facet ends a session in exactly one terminal state: `answered`, `unknown_to_informant`, or `not_applicable`. A session cannot complete otherwise.
- **P4 — Provenance is structural.** `provenance: stated` and informant attribution appear in every generated specification, enforced by the renderer, not by prompt.
- **P5 — Models are configuration.** Model id, temperature, and max tokens live in env/config. No model-specific logic in application code.
- **P6 — Minimalism.** Extend before adding. No new infrastructure, dependency, or service unless a requirement in this document cannot otherwise be met. SQLite before Postgres; one deployable; no queues, no Redis, no microservices.
- **P7 — Privacy by design.** Email addresses live in the register only, never in specification documents. The agent steers informants from named colleagues to role descriptions. No telemetry, no screen capture, no monitoring — statements only.
- **P8 — British throughout.** UK date format, sentence case, spaced en-dashes, £. Copy follows the VMO2 voice: plain-speaking, warm, confident, no hype, no emoji.

## 3. Locked product decisions

| # | Decision |
|---|---|
| D1 | Self-serve modality: user opens a tokenised link, identifies (name, email, role), is interviewed against preloaded project context |
| D2 | Projects (campaigns) are named by department; one campaign yields multiple process specifications |
| D3 | No automated email — links generated in the console and distributed manually; the system keeps the interview register |
| D4 | Output: Markdown structured to the 12 facets, non-conversational, one file per process per informant |
| D5 | Simplified Process Facets is the interview blueprint (machine spec in §7) |
| D6 | V1 scope only; V1.1 items (consolidation merge, ARIS import automation, stated-vs-actual) are **out of scope** |

**Explicit non-goals for V1**: automated email sending; SSO/enterprise auth; ARIS import automation; multi-informant merge into a single spec; task mining or any telemetry; analytics dashboards beyond the register; multi-language.

## 4. Architecture and stack

**Stack** (chosen for single-deployable minimalism and Claude Code buildability):
- **Next.js 14+ (App Router, TypeScript)** — one app serving both faces and the API routes.
- **SQLite via Drizzle ORM** — file database (`DATABASE_URL`, default `file:./data/app.db`); schema written so a later swap to Postgres is a connection-string change plus migration re-run. WAL mode on.
- **Anthropic API** via official SDK — interview engine and spec content generation. Default model from env (`MODEL`, default `claude-sonnet-4-6`).
- **Vitest** (unit/integration) + **Playwright** (E2E) + **tsx scripts** (eval harness).
- **No other runtime dependencies** without a `DECISIONS.md` entry justifying why P6 permits it.

**Deployment target**: `npm run build && npm start` on Node 20, plus a working `Dockerfile`. Hosting is decided outside this build; the deliverable is a runnable, containerised app.

**Environment** (`.env.example` required, never commit real values):
```
ANTHROPIC_API_KEY=
MODEL=claude-sonnet-4-6
DATABASE_URL=file:./data/app.db
BASE_URL=http://localhost:3000
ADMIN_PASSWORD=          # console access for the pilot; bcrypt-hashed at boot
RETENTION_DAYS=365       # surfaced in privacy notice; enforcement is a listed V1.1 item
SESSION_MAX_TURNS=60     # hard stop safety valve
```

**Directory layout**:
```
/app                    # Next.js routes: /(interview) /console /api
/lib
  /engine               # interview engine, coverage state machine, tools
  /facets               # facets.ts — the machine spec from §7 (single source of truth)
  /spec                 # renderer + schema validator for output Markdown
  /db                   # drizzle schema, migrations, queries
/reference              # read-only inputs listed above
/scripts                # eval harness, seed, link generation
/tests                  # unit, integration, e2e, eval fixtures
/public/brand           # copied VMO2 tokens + fonts + logo
STATUS.md               # build log — updated every phase (see §10)
DECISIONS.md            # any decision taken where this doc was silent
CLAUDE.md               # builder constitution — write from Appendix A at Phase 0
```

## 5. Data model

All tables carry `id` (nanoid), `createdAt`, `updatedAt`. Statements and turns are **append-only** — corrections supersede (`supersedesId`), never mutate.

```
Project        — name, department, description, status(active|closed)
Interviewee    — projectId, fullName, email, role, inviteToken(unique, unguessable ≥ 24 chars),
                 status(invited|in_progress|complete)
Session        — intervieweeId, projectId, processName(nullable working name),
                 status(open|review|complete|abandoned), startedAt, completedAt,
                 durationSec, turnCount
Turn           — sessionId, seq, speaker(agent|user|system), content, createdAt
Statement      — sessionId, facetId(1-12), content, kind(fact|step|rule|metric|issue|quote),
                 verbatim(bool), supersedesId(nullable)
                 # attributed via session → interviewee; provenance is implicitly 'stated'
CoverageState  — sessionId, facetId, state(pending|partial|answered|unknown_to_informant|
                 not_applicable), updatedAt   # one row per session × facet, seeded at start
Finding        — projectId, sessionId(nullable), facetId, type(unknown_retarget|
                 candidate_conflict|informant_flag), title, detail,
                 status(open|acknowledged|resolved), routedTo(free text)
Spec           — sessionId, version(int), markdown, coverageSummary(json),
                 openItems(json), generatedAt
```

**Indexes**: `Interviewee.inviteToken` unique; `Statement(sessionId, facetId)`; `CoverageState(sessionId, facetId)` unique.

## 6. Functional requirements

### FR-1 · Console — campaigns and links
- FR-1.1 Console lives under `/console`, gated by `ADMIN_PASSWORD` (simple session cookie; rate-limit attempts). Pilot-grade auth is acceptable and documented as such.
- FR-1.2 Create/edit a project: name, department, description, optional list of target process names.
- FR-1.3 Add interviewees (name, email, role) to a project; each gets a unique invite link `BASE_URL/i/{token}`. Provide copy-to-clipboard. **No email is sent** (D3).
- FR-1.4 Register view per project: interviewee, role, status, coverage (n/12 with bar), session duration, links to generated specs. Matches the demo's campaign view in content and brand.
- FR-1.5 Findings view per project: open findings with type, facet, detail, status transitions (open → acknowledged → resolved), and `routedTo`.
- FR-1.6 Candidate-conflict surfacing: for each facet within a project, when two or more informants' statements of kind `rule` or `metric` exist, list them side-by-side, attributed. A one-click "Raise as finding" creates a `candidate_conflict` Finding. **No automatic adjudication** (P2). A lightweight heuristic may pre-highlight pairs whose numeric values differ; the human decides.

### FR-2 · Interview entry
- FR-2.1 `GET /i/{token}` — invalid/used-up tokens get a polite dead-end page. Valid tokens land on the entry screen: privacy notice (Appendix C copy), prefilled name/email/role from the register (editable), start button.
- FR-2.2 Starting creates (or resumes — FR-3.8) the Session, seeds 12 CoverageState rows as `pending`, sets interviewee `in_progress`.
- FR-2.3 If the project has target processes, the user picks one or chooses "something else"; otherwise the engine opens with process elicitation (facet 1).

### FR-3 · Interview engine
- FR-3.1 The engine is a server-side loop: user turn → context assembly (system prompt from Appendix B + facet machine spec + full session transcript + current coverage states) → model call with tools → apply validated tool calls → agent turn streamed to the client.
- FR-3.2 **Tools exposed to the model** (server-validated; invalid calls are rejected and logged, and the model is reprompted once):
  - `record_statement(facetId, kind, content, verbatim)` — appends a Statement.
  - `set_coverage(facetId, state, rationale)` — proposes a coverage transition. Server enforces the legal transitions: `pending→partial|answered|unknown_to_informant|not_applicable`; `partial→answered|unknown_to_informant`; terminal states are immutable except `partial` (P3). Rationale is logged, not stored on the row.
  - `raise_finding(facetId, type, title, detail)` — permitted types in-session: `unknown_retarget`, `informant_flag`.
  - `end_interview()` — permitted only when zero facets are `pending` or `partial`; otherwise rejected with the list of unresolved facets, which the engine feeds back to the model.
- FR-3.3 One agent message per turn, containing **exactly one question** (closing/review turns excepted). Enforced by an output check (heuristic: at most one `?` outside quoted informant speech); on violation, reprompt once, then accept and log an engine warning.
- FR-3.4 Behavioural rules (Appendix B) are encoded in the system prompt **and**, where checkable, enforced in code — the eval harness (§9) is the arbiter of whether they hold.
- FR-3.5 Coverage rail: the interview page shows the 12 facets with live state (pending/partial/answered/unknown/n-a), progress count and bar — visually per the demo (capsule + endcap circle motif, state colours: green answered, yellow partial, pink unknown, grey pending).
- FR-3.6 A visible session timer runs; `durationSec` is persisted (feeds pilot criterion E2).
- FR-3.7 Hard stop: at `SESSION_MAX_TURNS`, the engine moves to review regardless, marking unresolved facets `unknown_to_informant` with an `informant_flag` finding noting the truncation.
- FR-3.8 Pause and resume: closing the tab loses nothing; reopening the link resumes the open session at the last turn. Implement by replaying persisted state — no in-memory session store (P6, crash-consistency).
- FR-3.9 Idempotency: double-submits of the same user turn (network retry) must not duplicate turns or statements — dedupe on (sessionId, seq).

### FR-4 · Review and completion
- FR-4.1 When `end_interview` is accepted, the engine produces a per-facet playback summary in-chat; the user confirms or corrects. Corrections route back into the loop as ordinary turns (statements supersede).
- FR-4.2 On confirmation: session `complete`, interviewee `complete`, spec generated (FR-5), register updated, closing message shown.

### FR-5 · Specification generation
- FR-5.1 The renderer is deterministic scaffolding + model-drafted section prose:
  - Frontmatter is built entirely in code from session data (schema below) — the model never writes it (P1, P4).
  - Per-facet body content is drafted by a model call **per facet** from that facet's Statements only, then validated: facet 5 must render as an ordered list where each step carries actor and system where stated; facets in `unknown_to_informant`/`not_applicable` render a fixed one-line template plus any finding reference.
- FR-5.2 Frontmatter schema (exact keys, validated before save):
  ```yaml
  ---
  process_name: <working name>
  department: <department>
  project_id: <project id>
  informant: {name: <name>, role: <role>}        # email never appears (P7)
  interviewed: <YYYY-MM-DD>
  duration_min: <int>
  provenance: stated
  coverage: {answered: n, unknown: n, not_applicable: n}
  open_items: [<one line per unknown_retarget finding>]
  ---
  ```
- FR-5.3 Body: twelve `##` sections in facet order, each titled `n. <facet name>` with its coverage state on the heading line. Findings render as clearly marked callout blocks with type and routing.
- FR-5.4 Spec is stored versioned (regeneration increments version, never overwrites) and downloadable as `.md` from the console.
- FR-5.5 A schema validator (`lib/spec/validate.ts`) checks every generated spec; an invalid spec is a hard failure that blocks session completion and surfaces in STATUS.md.

### FR-6 · Brand and UX
- FR-6.1 Copy `colors_and_type.css`, the four core Aeonik Pro weights (400/500/700/900) and `vmo2-logo.png` into `/public/brand`; all styling derives from the tokens.
- FR-6.2 The interview and console pages follow the approved demo's layout and component language: capsule tab/pill motif with endcap circles, flat white canvas, O2 Blue primary actions, status colours as in the demo. The demo file is the visual acceptance reference — screenshot comparison need not be pixel-perfect, but a reviewer should recognise them as the same product.
- FR-6.3 Responsive to 380px; visible keyboard focus; `prefers-reduced-motion` respected.

## 7. The facets machine spec (`lib/facets/facets.ts`)

Single source of truth, typed, consumed by the engine, the rail, the renderer, and the evals. For each facet: `id`, `name`, `objective`, `probes` (2–4 opening/follow-up questions), `answeredWhen` (plain-language rubric the model is given for `set_coverage` proposals), `example` (calibration example shown to the model, in the voice of a worked answer). Content:

| # | Facet | Objective (condensed) | `answeredWhen` rubric (condensed) |
|---|---|---|---|
| 1 | Process identity & context | Name, purpose, start/end boundaries | Purpose + both boundaries stated |
| 2 | Stakeholders & resources | Roles involved, who does what, hand-off partners | Roles enumerated for the main flow |
| 3 | Triggers & events | What starts the process; timing/frequency patterns | At least the primary trigger, with cadence if any |
| 4 | Inputs & outputs | What comes in, what is produced | Primary inputs and outputs both stated |
| 5 | Workflow & activities | Ordered steps, actors, systems, decisions, hand-offs | An ordered account of the main path incl. at least one hand-off/decision if any exist |
| 6 | Business rules & decisions | Rules, approval criteria and thresholds, decision logic | Rules stated to thresholds/levels where approvals exist (probe to £ bands and governance tiers) |
| 7 | Data & information | Records created/used, where they live | Key records and their systems |
| 8 | Technology & systems | Systems/tools touched | Systems named for the main path |
| 9 | Risk, controls & compliance | Controls, regulatory obligations, checks | Controls stated — or an honest unknown |
| 10 | Variants & exceptions | Alternative paths, what happens when it goes wrong | At least the main exception path |
| 11 | Performance | Volumes, durations, targets | Volume and end-to-end duration, even approximate |
| 12 | Bottlenecks & issues | Longest task, queues, workarounds, standardisation | At least one concrete bottleneck probed (longest task, queue point) and a standardisation read |

Facet 6 carries the calibration example in Paul's pattern (value bands → approval tiers). Facet 12 probes must include "which part takes longest" and "where does work queue up".

## 8. Build phases and gates

Execute strictly in order. A phase is complete only when its gate passes; then update `STATUS.md`, commit (conventional commits, one logical commit per phase minimum), and proceed. If a gate fails, fix and re-run — that is the loop. Never skip a gate; never mark a gate passed without running it.

| Phase | Build | Gate (all must pass) |
|---|---|---|
| **0 · Scaffold** | Next.js + TS + Drizzle + Vitest + Playwright + lint/format; `.env.example`; write `CLAUDE.md` from Appendix A; copy brand assets; `STATUS.md` + `DECISIONS.md` created | `npm run lint`, `npm run typecheck`, `npm test` (empty suite ok), `npm run build` all green |
| **1 · Data layer** | Full schema §5, migrations, query module, seed script creating the demo campaign (Consumer operations, 3 interviewees) | Unit tests: append-only statements (supersede path), coverage transition legality, token uniqueness — green |
| **2 · Entry flow** | FR-2 complete: token route, dead-end page, entry screen with privacy copy, session creation/resume shell | Integration tests: valid/invalid/reused token behaviour; E2E: entry renders, session row created |
| **3 · Engine** | FR-3 complete: loop, tools with server validation, coverage machine, one-question rule, rail UI, timer, hard stop, resume, idempotency | Unit: every illegal tool call rejected; integration: mocked-model loop drives coverage to completion; E2E with mocked model: golden path from demo script reaches review with 11 answered + 1 unknown |
| **4 · Review + spec** | FR-4, FR-5 complete: playback, corrections supersede, renderer, validator, versioning, download | Unit: frontmatter/schema validator (fixtures incl. failure cases); integration: golden-path session yields a valid spec with email absent, provenance present, open_items populated |
| **5 · Console** | FR-1 complete: auth, projects, links, register, findings, candidate conflicts, spec download | E2E: architect creates campaign → issues link → (mocked) interview completes → register shows coverage + spec; conflict pair surfaces and raises finding |
| **6 · Live-model eval loop** | Wire the real Anthropic API; build the eval harness §9; iterate prompt/engine until eval gates pass | **Eval gates §9 pass on 3 consecutive runs.** Record scores in STATUS.md |
| **7 · Hardening + pilot pack** | Rate limiting on public routes, security headers, input length caps, Dockerfile, README (setup, ops, backup of the SQLite file), pilot checklist mapping to E1–E5 instrumentation | `npm run build` + container boots + full test suite + eval suite green; README complete; STATUS.md final entry |

## 9. The evaluation harness — the loop that proves it works

`scripts/eval.ts` runs a **simulated informant** against the real engine end-to-end: a second model call plays the informant from a persona fixture, the engine conducts the interview exactly as in production, and assertions run on the resulting session, statements, coverage, and spec.

**Persona fixtures** (`tests/eval/personas/*.json`) — each contains ground-truth facts per facet, including deliberate gaps:
1. **Cooperative** — the demo's complaints advisor: fluent answers, facet 9 genuinely unknown, a clear facet-12 bottleneck, approval thresholds at £25/£100/£500.
2. **Terse** — one-line answers; the engine must probe to reach rubric depth.
3. **Rambling** — long tangential answers mixing facets; the engine must file statements to the right facets and keep to one question per turn.

**Assertions per run** (hard gates):
- A1 All 12 facets terminal; zero `pending`/`partial` at completion (P3).
- A2 Persona's known-unknown facet lands as `unknown_to_informant` **with** an `unknown_retarget` finding — never guessed into `answered`.
- A3 Facet 6 statements capture the persona's numeric thresholds (string/number match against fixture).
- A4 Facet 12 contains at least one bottleneck statement matching fixture ground truth.
- A5 One question per agent turn across the transcript (heuristic from FR-3.3), ≥ 95% of turns.
- A6 No leading questions: transcript contains none of the banned framings list (e.g. "so presumably…", "I assume…", "the correct process is…", suggestions of steps the informant hasn't stated).
- A7 Turn count ≤ 40 for cooperative, ≤ 55 otherwise.
- A8 Generated spec passes the schema validator; email absent; `provenance: stated` present; open_items reflect A2.
- A9 Facet-fidelity spot check: ≥ 80% of fixture ground-truth facts appear in statements of the correct facet (judge = string containment first, model-graded fallback with the grading prompt stored in the repo).

**Gate for Phase 6**: all personas pass A1–A9 on **three consecutive runs** (temperature as configured, different seeds where applicable). On failure: diagnose from transcripts (persisted to `tests/eval/runs/<timestamp>/`), adjust the system prompt, probes, or engine checks, and re-run. Iterate until stable. Cost guard: cap eval spend per run via `max_tokens` and turn limits; log token usage per run in STATUS.md.

## 10. Working agreement for the builder (hands-off protocol)

- **STATUS.md** after every phase: date, phase, what was built, gate results (paste test/eval summaries), open concerns. This is the audit trail for human review.
- **DECISIONS.md** for every choice this document doesn't cover — one line: context, decision, why it's the minimal option.
- **Never**: commit secrets or `.env`; call external services other than the Anthropic API; add dependencies without a DECISIONS entry; weaken a gate to pass it; mark eval gates green without persisted run artefacts.
- **Stop and surface** (the only reasons to halt for the human): a gate that cannot pass after three distinct remediation attempts; a security concern; an ambiguity that materially changes scope. Everything else: decide, record, continue.
- Definition of done = Phase 7 gate + a fresh clone runs `npm i && npm run setup && npm run dev` to a working product per the README, and a human can replay the demo's golden path against the live engine.

---

## Appendix A — CLAUDE.md to write at Phase 0

```markdown
# Process capture — builder constitution
You are building the VMO2 SME interview tool V1 against BUILD-REQUIREMENTS.md,
which is authoritative. Principles P1–P8 are non-negotiable; the phase gates in
§8 and eval gates in §9 define done. Work phase by phase; run every gate; update
STATUS.md and DECISIONS.md as specified in §10. Prefer the simplest solution;
extend before adding. The approved demo in /reference is the UX and brand
reference. British English, sentence case, spaced en-dashes, £, VMO2 voice.
Never commit secrets. Never weaken a gate.
```

## Appendix B — interview agent system prompt (source of truth: iterate here, record changes in DECISIONS.md)

Core content (assemble with facet machine spec + live coverage injected per turn):

```
You are the Process capture assistant, interviewing a {role} at Virgin Media O2
about a process they perform, on behalf of the process architecture team. Your
goal: reach a terminal coverage state on all 12 facets, honestly.

Conduct rules — these are strict:
- One question per message, in plain conversational British English. Never use
  facet names or modelling jargon with the informant.
- Anchor concrete before general: early on, ask them to walk through the last
  real occurrence before asking how it usually works.
- Probe approvals to thresholds and levels (£ bands, governance tiers), not to
  "it gets approved".
- Treat bottlenecks (facet 12) as first-class: which part takes longest, where
  work queues, workarounds, how standardised the work is.
- "I don't know" is a good answer. Record it via set_coverage
  unknown_to_informant and raise_finding unknown_retarget. Never guess, never
  pressure, never fill gaps yourself.
- Never lead: record the process as performed; do not suggest, correct, or
  optimise. Do not propose steps the informant has not stated.
- Attribute, don't average: if the informant contradicts themselves, ask once to
  clarify; record what they settle on, superseding the earlier statement.
- Steer from named colleagues to roles ("the finance approver") unless naming a
  formal process owner.
- Respect time: aim for 25–40 minutes of conversation; if the informant seems
  rushed, prioritise unvisited facets over depth.
- Use record_statement for every substantive fact, filed to the correct facet,
  as the informant states it. Use verbatim=true sparingly for phrases worth
  preserving exactly.
- Call end_interview only when no facet is pending or partial. Then deliver a
  short per-facet playback and invite corrections before closing warmly.
```

## Appendix C — entry privacy notice (fixed copy)

> **Before you start.** We'll record your name, role and what you tell us about your own work, to build a process specification for your department. No screen recording, no monitoring – just this conversation. Your answers are attributed to you and shared with the process architecture team. Data is retained for {RETENTION_DAYS} days and you can ask for it to be removed at any time. Please describe colleagues by role rather than name.

## Appendix D — traceability to the pilot criteria

| Pilot criterion | Instrumented by |
|---|---|
| E1 coverage ≥ 80% answered, zero silent gaps | CoverageState terminal-only completion (P3) + register roll-up |
| E2 median ≤ 40 min | Session.durationSec, surfaced in register |
| E3 fidelity | Spec download for process-owner review; findings loop |
| E4 ARIS usability | FR-5 facet-5 structured rendering; validator |
| E5 experience | Manual survey in pilot (out of product scope) — closing screen links to it via configurable URL |
