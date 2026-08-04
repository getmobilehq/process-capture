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

---

## Phase 2 · Entry flow — complete (2026-07-17)

**Built**

- `lib/entry.ts` — `resolveEntry` (valid / invalid / used-up) and `startSession`
  (create-or-resume, seeds coverage, sets interviewee in_progress, persists
  identity edits). Server-owned (P1).
- `app/i/[token]/page.tsx` — entry screen or polite dead-end (FR-2.1).
- `app/i/[token]/actions.ts` — `startInterview` server action (FR-2.2).
- `components/entry/EntryScreen.tsx` — privacy notice (Appendix C copy, RETENTION_DAYS
  interpolated), editable prefilled identity, optional process picker (FR-2.3).
- `components/entry/DeadEnd.tsx` — invalid / used-up dead-ends.
- `app/i/[token]/interview/page.tsx` — Phase 2 interview shell (redirects if no open
  session) with the live coverage rail.
- `components/interview/CoverageRail.tsx` — 12-facet rail, gradient progress bar,
  capsule+endcap motif, demo state colours (FR-3.5).
- `app/brand-ui.css` — shared VMO2 component language from the approved demo.
- Playwright global setup seeds `data/e2e.db`; Chromium installed.

**Gate**

- [x] lint — clean
- [x] typecheck — clean
- [x] test — 18 unit+integration passing, incl. entry: valid/invalid/reused token,
      create-vs-resume, identity persistence, used-up/unknown rejection
- [x] build — `✓ Compiled successfully` (entry + interview routes dynamic)
- [x] e2e — 3 passing: unknown-token dead-end, entry renders (privacy + start
      button), starting creates exactly one session row and lands on the interview

**Open concerns** — the interview page is a shell; the conversational engine (FR-3)
lands in Phase 3.

---

## Phase 3 · Interview engine — complete (2026-07-17)

**Built**

- `lib/engine/tools.ts` — the four model tools with Anthropic schemas + Zod
  validators (record_statement, set_coverage, raise_finding, end_interview).
- `lib/engine/prompt.ts` — Appendix B system prompt: conduct rules + facet spec +
  live coverage injected each turn.
- `lib/engine/model.ts` — model boundary; live Anthropic call + `MOCK_MODEL` branch.
- `lib/engine/mock.ts` — deterministic scripted model driving the golden path.
- `lib/engine/one-question.ts` — one-question heuristic (quotes stripped).
- `lib/engine/engine.ts` — `openInterview` + `processUserTurn`: tool loop, server
  validation/apply (P1), one-question reprompt (FR-3.3), resume by replay (FR-3.8),
  idempotency on (sessionId, seq) (FR-3.9), hard stop → review (FR-3.7).
- `app/api/interview/[sessionId]/turn/route.ts` — turn endpoint (seq/length caps).
- `components/interview/InterviewRoom.tsx` — client chat, live coverage rail,
  session timer (FR-3.6), optimistic send with idempotent retry.
- Interview page opens the interview server-side and renders the room.

**Gate**

- [x] lint — clean
- [x] typecheck — clean
- [x] test — 32 unit+integration: **every illegal tool call rejected** (8: end
      while pending, illegal transition, bad facetId/kind, disallowed finding type,
      unknown tool); **mocked-model loop drives coverage to completion**; opening =
      one question; unknown_retarget finding on the unknown facet; one-question per
      turn; idempotent resubmit; hard-stop truncation.
- [x] build — `✓ Compiled successfully`
- [x] e2e (mocked) — golden path: start → answer → **review with 11 answered + 1
      unknown**, UI shows "12/12 resolved" and completion, DB status = review.

**Open concerns** — token-level streaming deferred to V1.1 (D3.1, flagged for Paul).
Review confirm/correct + spec generation are Phase 4.

---

## Phase 4 · Review + spec — complete (2026-07-17)

**Built**

- `lib/spec/validate.ts` — schema validator (FR-5.5): frontmatter key set, `provenance:
  stated` (P4), email absence (P7), 12 ordered sections, facet-5 ordered-list rule.
- `lib/spec/draft.ts` — per-facet prose drafting from that facet's live statements
  only; deterministic under mock, model-drafted live; facet 5 → ordered list.
- `lib/spec/render.ts` — deterministic frontmatter built in code (P1/P4), body
  assembly, unknown/not-applicable templates, findings callouts.
- `lib/spec/generate.ts` — render → validate → save; invalid spec throws and blocks
  completion (FR-5.5).
- `lib/engine/engine.ts` `completeInterview` — confirm → generate spec → session +
  interviewee complete (FR-4.2); review corrections route as ordinary turns (FR-4.1).
- `POST /api/interview/[sessionId]/confirm`, `GET /api/spec/[sessionId]` (Markdown
  download, versioned via `?v=`).
- `InterviewRoom` review state: Finish button + correction box; complete state with
  closing + optional survey link.

**Gate**

- [x] lint — clean
- [x] typecheck — clean
- [x] test — 48 unit+integration: **validator with 12 fixtures incl. every failure
      case**; **golden-path yields a valid spec** — provenance present, email absent,
      open_items populated, coverage {11,1,0}, session+interviewee complete;
      idempotent completion; regeneration increments version; non-review completion
      refused.
- [x] build — `✓ Compiled successfully`
- [x] e2e (mocked) — golden path → Finish → complete; spec downloads with
      `provenance: stated` and no email.

**Open concerns** — none new.

---

## Phase 5 · Console — complete (2026-07-18)

**Built**

- `lib/auth.ts` — bcrypt-at-boot password check, HMAC session cookie, per-IP login
  rate-limiter; `lib/console-auth.ts` `requireAdmin` guard (FR-1.1).
- Login page + `POST /api/console/login` (rate-limited) + `/logout`.
- `/console` — campaign list + new-campaign form (name, department, description,
  target processes) (FR-1.2).
- `/console/projects/[id]` with three tabs:
  - **Register** (FR-1.4) — add interviewee (issues unique link, copy-to-clipboard,
    no email — FR-1.3), table of role/status/coverage bar/duration/spec download.
  - **Findings** (FR-1.5) — list with type/facet/detail and status + routedTo edits.
  - **Candidate conflicts** (FR-1.6) — cross-informant rule/metric statements
    side-by-side, numeric-difference highlight, "Raise as finding".
- `lib/console.ts` register + conflict read models; `components/console/CopyLink`.
- Mock records facet 6 (role-banded rule) + facet 11 (metric) so conflicts surface.

**Gate**

- [x] lint — clean
- [x] typecheck — clean
- [x] test — 52 unit+integration (adds auth: password verify, session token,
      rate-limit).
- [x] build — `✓ Compiled successfully`
- [x] e2e — **architect creates campaign → issues links → two mocked interviews
      complete → register shows coverage + downloadable specs → facet-6 conflict pair
      surfaces across informants → raised as a candidate_conflict finding.**

**Open concerns** — none new. Phase 6 wires the live model + eval harness (needs the
API key, now in `.env`).

---

## Phase 6 · Live-model eval loop — GATE PASSED (2026-07-18)

**Built**

- Live Anthropic API wired (`lib/engine/model.ts` real path; `lib/spec/draft.ts`
  per-facet drafting). Verified against `claude-sonnet-4-6`.
- `scripts/eval.ts` — runs a simulated informant against the real engine end-to-end,
  in an isolated in-memory DB per run, and checks A1–A9. Per-run token usage logged
  (cost guard); transcripts + results persisted to `tests/eval/runs/<ts>/`.
- `lib/eval/informant.ts` — the persona-driven simulated informant.
- `lib/eval/assertions.ts` — A1–A9 (string-first fidelity with a model-graded
  fallback).
- `lib/usage.ts` — process-wide token accounting.
- `tests/eval/personas/{cooperative,terse,rambling}.json` — persona fixtures with
  ground-truth facts, £-band thresholds (facet 6), a bottleneck (facet 12), and a
  genuine unknown (facet 9).
- `scripts/load-env.ts` — `.env` loading for tsx scripts.

**Result — §9 gate met (`claude-sonnet-4-6`, final batch 2026-07-18T…)**

All 3 personas passed A1–A9 on **3 consecutive runs** in a single batch (exit 0):

```
cooperative  run1 PASS  run2 PASS  run3 PASS   (23/20/19 turns)
rambling     run1 PASS  run2 PASS  run3 PASS   (20/17/15 turns)
terse        run1 PASS  run2 PASS  run3 PASS   (28/21/25 turns)
Gate (§9): PASS — all personas passed A1–A9 on 3 consecutive runs.
Totals: 3,824,432 input + 123,368 output tokens across the batch.
```

Two flakes surfaced during iteration and were fixed (both improve the product, not
just the eval):

- **A2 (honest unknown)** flaked when the informant's facet‑6 approval tiers read as
  facet‑9 "sign‑offs", or the model set unknown without the paired finding. Fixed by
  server-auto-pairing the `unknown_retarget` finding on any move to
  `unknown_to_informant` (P1/P2, deduped per facet) + an agent/informant firewall so
  approval tiers stay a facet‑6 rule (D6.5).
- **A5 (one question/turn)** flaked for the rambling persona (a tacked-on clarifying
  question, just under 95% with few turns). Fixed by an explicit no‑second‑question
  system rule + reprompting up to twice before accepting (D6.6).

**Gate**

- [x] harness built + persists artefacts + logs token usage (§9)
- [x] live model wired and exercised
- [x] **all 3 personas × A1–A9 × 3 consecutive runs — PASS**

**Open concerns** — high input-token count per run (~0.4–0.6M): the facet-spec system
prompt is re-sent each turn. Add prompt caching before scaling — a cost optimisation,
not a correctness issue.

**Post-pilot fix (2026-07-18): two-phase turn.** Live use surfaced that the single
tool-loop let the model skip extraction (coverage stayed 0/12). Split each turn into
an extraction phase (tools only, first call forced) + a question phase (no tools).
**Full 3×3 re-confirmed with the two-phase engine (2026-07-19):** all 3 personas ×
A1–A9 × 3 consecutive runs PASS (cooperative/rambling/terse, 9/9 runs, exit 0). And
materially better than the pre-fix batch — 7–15 turns (was 13–46), ~2.7M tokens (was
3.8–4.7M). Client resilience added (maxRetries 4 + 60s timeout on all Anthropic
clients; eval retries a run on transient connection errors) after a run aborted on a
transient EHOSTUNREACH — the same error class that had been crashing the dev server.

---

## Phase 7 · Hardening + pilot pack — complete (2026-07-18)

**Built**

- `lib/rate-limit.ts` — in-memory fixed-window limiter; applied to the public turn
  endpoint (40/min per IP) in addition to login (Phase 5).
- Security headers in `next.config.mjs` — CSP, HSTS, X-Frame-Options, nosniff,
  Referrer-Policy, Permissions-Policy; `poweredByHeader` off.
- Input length cap on the turn endpoint (4000 chars).
- `Dockerfile` (multi-stage) + `.dockerignore` + `scripts/migrate.mjs` (plain-Node
  migration entrypoint so the container needs no tsx). Migrations run at container
  start; SQLite lives on a `/app/data` volume.
- `README.md` — setup, commands, architecture, operations (SQLite backup/restore,
  container deploy, security posture), and the **E1–E5 pilot checklist**.

**Gate**

- [x] lint / typecheck / `npm test` (52) / `npm run build` — all green with hardening
- [x] E2E (5, mocked) — green
- [x] README complete (setup, ops, backup, pilot checklist)
- [x] **container boots** — `docker build` → 1.17 GB image; `docker run` verified:
      migrations applied at start (`Migrations applied to file:./data/app.db`), Next
      `✓ Ready`, `app.db` created on the mounted `/app/data` volume, all faces serve
      (home 200, console→login 200, invalid token → dead-end 200), and all security
      headers present (CSP, HSTS, X-Frame-Options, nosniff, Referrer-Policy,
      Permissions-Policy).

**Open concerns** — none. All seven phase gates are met.

---

## Definition of done — met (2026-07-18)

- Phases 0–7 all complete; each gate run and recorded above.
- Static + tests: `lint`, `typecheck`, **52 unit/integration**, **5 E2E** (mocked),
  `build` — all green.
- Live model: **§9 eval gate PASS** — 3 personas × A1–A9 × 3 consecutive runs.
- Container: builds and boots; migrates + serves both faces on a volume.
- A fresh clone runs `npm i && npm run setup && npm run dev` to a working product
  per the README; a human can replay the demo golden path against the live engine.

One deliberate, flagged deviation for review: token-level streaming is deferred to
V1.1 (D3.1) — turns use a single JSON exchange. Everything else follows the brief.

---

## Delta v1.1 — overnight run (2026-08-01)

Worked in the delta's priority order: R1 → R2 → R10 → R9 → R5 → R8 → R4 → R3 → R6.
Each requirement is one commit, gates run before every commit.

### Complete

- **R1 — Completeness scoring (P0).** `2f0a2e4`. 40 checklist elements across the 12
  facets; new `element_states` table; the facet meter is *derived* and
  `set_coverage` can no longer propose `answered`/`partial`. Rail is an expandable
  checklist with readbacks. Scoring rubric rewritten with contrastive pairs.
  Interviewee-driven N/A with a mandatory reason.
- **R2 — Deterministic facets as pick-lists (P0).** `76997af`. Facets 2/3/4/8 are
  tick-lists with an escape hatch; the other eight stay open. New `entities` +
  `entity_mentions`, canonical keys, VMO2 taxonomy seeded per project, every option
  carrying its source. Acceptance met: a system named at facet 4 is pre-ticked at
  facet 8 with attribution.
- **R10 — Interview UX and data-loss protection (P0).** `55e16c7`. Three
  unmistakable capture states with icon *and* word, pulse and timer. New
  `answer_drafts`: continuous autosave, session recovery, soft discard with Undo,
  re-record archiving the prior take, `beforeunload` guard, destructive controls
  separated from Submit. Nothing in the draft layer hard-deletes.
- **R9 — Bounded interview and graceful finish (P0).** `0976835`. Question budget
  with a visible counter; `lib/engine/priority.ts` ranks by information value
  (shared with R4.2 — one implementation); "Finish recording" works at any point;
  unreached elements land in `open_items` naming their facet; truncated sections
  state their own gaps in the prose.
- **R4 — Adaptive follow-ups (P1).** `e02bf8c`. The question phase is handed the
  top two ranked candidates, each citing what prompted it. New
  `lib/engine/ledger.ts` — a claims ledger derived from statements, checklist and
  entity mentions; follow-up generation reads the ledger, not the transcript, which
  makes "never ask twice" structural.
- **R5.1 — Typed process graph (P0, the R5 foundation).** `565c030`. Zod schema for
  the graph, change-sets and opportunity overlay, plus the structural validators.
  Mandatory `sourceFacet` lineage; planted faults fail loudly. R5.4's
  "every change resolves a bottleneck" and R5.5's "no label without evidence" are
  both enforced.

- **R5.2 — deterministic BPMN 2.0 serialisation.** `3ad6301`. Pure
  `ProcessGraph → BPMN 2.0 XML` with DI layout, rolled rather than elkjs (DL.28).
  Round-trip verified; ids sanitised into valid XML names (DL.29).
- **R5.1 extraction pass.** `0df52e9`. Forced tool call, server-stamped provenance,
  one validation retry that refuses to invent structure (DL.31–DL.32).

### Not started

- **R5.3–R5.6** — bpmn-js rendering, the as-is / to-be / opportunity views and the
  Process map tab. Needs bpmn-js, wanting a P6 justification in DECISIONS.md.
- **R5.7** — eval fixtures, still without the fault-management ground truth.
- **R8 — Suggested responses (answer chips).** The pieces it needs exist: entity
  sourcing (R2) and the ranking module (R9.2/R4.2). Note R8.1's rule that chips
  never appear on facets 10 or 12.
- **R3 — Artefact ingestion.** The `documented` / `corroborated` / `conflicting`
  provenance classes are already declared in the ledger and the `conflicting` tier
  is wired but empty in the ranking, so R3 slots in without reshaping either.
- **R6 — Process-template pre-fetch (P2).** Explicitly deferrable per the delta.

### Gates

`lint` ✓, `typecheck` ✓, **129 unit/integration** ✓, **10 E2E** ✓ (was 5).
Migrations 0001–0003 generated and applied.

**§9 eval gate: PASS (2026-08-04).** All three personas passed A1–A9 on three
consecutive runs: cooperative 3/3, rambling 3/3, terse 3/3. A3 — the threshold
regression R1 introduced — did not fail once across ten runs after the DL.24 fix,
confirmed against the live model.

### Known gaps and deviations

1. **A3 regression — diagnosed, fixed and confirmed (closed).** Both eval
   failures were A3 (facet 6 numeric thresholds): `missing: 500`, then
   `missing: 100,500`. Cause was mine: V1's facet rubric said "probe to £ bands and
   governance tiers", but the R1 element rubric said thresholds are captured when
   "concrete thresholds are given" — which one figure satisfies, so the model closed
   the element after the first number and stopped climbing the ladder.
   `rules.thresholds` and `rules.approvals` now require every band up to the top of
   the ladder, and the scoring section carries a worked contrastive example of the
   partial-ladder mistake. Verified: rambling went 1 failure → 3/3, and the terse
   run that previously failed with `missing: 100,500` now passes.
2. **Live transcription is chunked, not streaming (DL.14).** R10.2 asks for text
   appearing as the informant speaks; Whisper has no streaming interface. Needs a
   realtime ASR — a provider decision, so flagged rather than assumed.
3. **Interview UI now verified — closed.** `tests/e2e/delta.spec.ts` drives the
   interactive states in a real browser: expanding a facet to its plain-language
   checklist, the inline not-applicable path with its reason, pick-list options with
   source labels and the escape hatch, a draft surviving a reload behind the
   recovery banner, discard behind a confirmation naming the cost then undone, and
   the visible question budget.
4. **The delta's fixtures are still absent.** `spec-fault-management-process-v1.md`
   and `r5-reference/*.svg` are not in the repo. Per your call they were treated as
   guidance, so R5.7's eval assertions have not been written against ground truth.

### Suggested next session

R5.3–R5.6 — the bpmn-js rendering block. Everything below it is now built and
gated: the graph, its validators, the extractor and the serialiser.
