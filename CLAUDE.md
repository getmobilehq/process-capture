# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state — read first

**Nothing has been built yet.** This folder is a *build package*, not a codebase: a
brief, an approved demo, a spec, and the brand system. There is no `package.json`, no
git repo, no application source. Your job is to build the product described in
`BUILD-REQUIREMENTS.md`, not to modify existing code.

Files present today:
- `BUILD-REQUIREMENTS.md` — **the authoritative build brief.** Self-sufficient; everything
  needed to build, test, and self-verify. When it conflicts with anything else (including
  this file), it wins.
- `process-capture-demo.html` — the approved interactive demo. **The UX and visual reference.**
  Open it to see the golden path, layout, and brand execution the built product must reproduce.
- `SME-interview-tool-V1-spec.docx` — the product spec `BUILD-REQUIREMENTS.md` operationalises.
- `VMO2 Design System/` — the brand system (tokens, Aeonik Pro fonts, logos, UI kits). Copy
  tokens/fonts/logo into the app; do not restyle or approximate.

Before building, `BUILD-REQUIREMENTS.md` §4 expects these reference artefacts relocated into
`/reference` (read-only) and brand assets copied into `/public/brand`.

## Builder constitution (from §Appendix A)

You are building the VMO2 SME interview tool V1 against `BUILD-REQUIREMENTS.md`, which is
authoritative. Principles P1–P8 are non-negotiable; the phase gates in §8 and eval gates in §9
define done. Work phase by phase; run every gate; update `STATUS.md` and `DECISIONS.md` as
specified in §10. Prefer the simplest solution; extend before adding. The approved demo in
`/reference` is the UX and brand reference. British English, sentence case, spaced en-dashes, £,
VMO2 voice. Never commit secrets. Never weaken a gate.

## What the product is

The **VMO2 SME interview tool** ("Process capture"). VMO2's processes are tacit — held in
people's heads. This tool runs a structured conversational interview (an Anthropic-powered
agent) against 12 process facets and produces an attributed, provenance-tagged Markdown
process specification per informant, per process, for a modeller to draft into ARIS.

Two faces, one app:
- **Process user** — opens a tokenised link (`/i/{token}`), self-identifies, is interviewed,
  reviews a playback, done in 25–40 min.
- **Process architect** — `/console` (password-gated): creates campaigns, issues links, watches
  the register fill, downloads specs and findings.

## Non-negotiable principles (from §2 — violating one is a defect)

- **P1 — Model proposes, server disposes.** Coverage/session state and the spec schema are owned
  by deterministic server code. The model proposes via tool calls; the server validates and applies.
  The model never mutates state or free-writes spec structure.
- **P2 — Attribute everything; average nothing.** Every statement stored against its informant.
  Conflicts are surfaced as findings for a human — never merged, averaged, or overwritten.
- **P3 — No silent gaps.** Every facet ends in exactly one terminal state: `answered`,
  `unknown_to_informant`, or `not_applicable`. A session cannot complete otherwise.
- **P4 — Provenance is structural.** `provenance: stated` and informant attribution are emitted by
  the renderer, not by prompt.
- **P5 — Models are configuration.** Model id / temperature / max tokens live in env. No
  model-specific logic in application code.
- **P6 — Minimalism.** Extend before adding. SQLite before Postgres; one deployable; no queues,
  Redis, or microservices. New dependency ⇒ a justifying `DECISIONS.md` entry.
- **P7 — Privacy by design.** Emails live in the register only, never in spec documents. No
  telemetry, no monitoring — statements only.
- **P8 — British throughout.** UK dates, sentence case, spaced en-dashes, £, VMO2 voice: plain,
  warm, confident, no hype, no emoji.

## Intended stack & architecture (prescribed by §4 — not yet scaffolded)

- **Next.js 14+ (App Router, TypeScript)** — one app serving both faces + API routes.
- **SQLite via Drizzle ORM** — file DB (`DATABASE_URL`, default `file:./data/app.db`), WAL on;
  schema written so a Postgres swap is connection-string + re-migrate.
- **Anthropic API** (official SDK) — interview engine + per-facet spec drafting. Model from
  `MODEL` env (brief's default `claude-sonnet-4-6`).
- **Vitest** (unit/integration) + **Playwright** (E2E) + **tsx** scripts (eval harness).

Directory layout the brief mandates:
```
/app        Next.js routes: /(interview) /console /api
/lib
  /engine   interview loop, coverage state machine, model tools
  /facets   facets.ts — the 12-facet machine spec (SINGLE SOURCE OF TRUTH, §7)
  /spec     Markdown renderer + schema validator
  /db       drizzle schema, migrations, queries
/reference  read-only inputs (the files listed above)
/scripts    eval harness, seed, link generation
/tests      unit, integration, e2e, eval fixtures
/public/brand  copied VMO2 tokens + fonts + logo
```

Key flows:
- **Interview engine** (`/lib/engine`, FR-3) — server loop: user turn → assemble context (system
  prompt §Appendix B + facet spec + full transcript + live coverage) → model call with tools →
  server validates & applies tool calls → stream agent turn. Tools: `record_statement`,
  `set_coverage` (server enforces legal transitions), `raise_finding`, `end_interview` (only when
  no facet is `pending`/`partial`). One question per agent turn. Resume by replaying persisted
  state — no in-memory session store. Dedupe turns on `(sessionId, seq)`.
- **Spec generation** (`/lib/spec`, FR-5) — deterministic frontmatter built in code (model never
  writes it), per-facet prose drafted by model from that facet's statements only, then validated
  by `lib/spec/validate.ts`. An invalid spec is a hard failure that blocks completion.
- **Data model** (§5) — append-only `Turn`/`Statement` (corrections supersede via `supersedesId`,
  never mutate); one `CoverageState` row per session × facet.

## Build protocol

Build **strictly phase by phase** per §8 (0 Scaffold → 7 Hardening). A phase is done only when its
gate passes; then update `STATUS.md`, commit (conventional commits), and proceed. Never skip or
weaken a gate. The **eval harness** (`scripts/eval.ts`, §9) is the arbiter: it runs a simulated
informant against the real engine; Phase 6 requires all personas passing assertions A1–A9 on three
consecutive runs.

`STATUS.md` (build log, updated every phase) and `DECISIONS.md` (one line per decision the brief
didn't cover) are required artefacts — create them at Phase 0.

Commands (once Phase 0 scaffolds them, per §8 gates): `npm run lint`, `npm run typecheck`,
`npm test`, `npm run build`. Deployment target: `npm run build && npm start` on Node 20 + a
working `Dockerfile`.

Stop and surface to the human only for: a gate that cannot pass after three distinct remediation
attempts; a security concern; an ambiguity that materially changes scope. Everything else — decide,
record in `DECISIONS.md`, continue.

## Brand

All styling derives from `VMO2 Design System/colors_and_type.css` tokens — use semantic tokens
(`--fg`, `--bg`, `--brand-primary`), raw swatches (`--o2-blue #0050FF`, `--vm-red #E10A0A`,
`--vmo2-pink #FF0090`) only for logo/brand splashes. Font is **Aeonik Pro** (paid; the woff files
are VMO2-licensed). The signature motif is the **capsule + endcap circle** — a pill label with a
contrasting circle overlapping its right edge; use it generously. Coverage-rail state colours match
the demo: green answered, yellow partial, pink unknown, grey pending. The demo is the visual
acceptance reference — a reviewer should recognise the built product as the same thing.
