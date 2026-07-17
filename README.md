# Process capture — VMO2 SME interview tool

Captures how a process really works, in the words of the person who runs it. A
conversational agent interviews a process user against **12 process facets** and
produces an **attributed, provenance-tagged Markdown specification** per informant,
per process — ready for a modeller to draft into ARIS. It is the human "why" layer
of the wider BPR pipeline.

Two faces, one app:

- **Process user** — opens a tokenised link, self-identifies, is interviewed, reviews
  a playback, done in 25–40 minutes.
- **Process architect** — signs in to the console, creates campaigns, issues links,
  watches the register fill, downloads specifications and findings.

Built against `BUILD-REQUIREMENTS.md` (authoritative). Non-negotiable principles
P1–P8 and the phase gates in §8 / eval gates in §9 define "done".

---

## Stack

- **Next.js 14 (App Router, TypeScript)** — one app serving both faces + API routes.
- **SQLite via Drizzle ORM** (`better-sqlite3`, WAL) — one file database; the schema
  is written so a later swap to Postgres is a driver + connection-string change.
- **Anthropic API** — interview engine + per-facet spec drafting (model from `MODEL`).
- **Vitest** (unit/integration) + **Playwright** (E2E) + **tsx** scripts (eval harness).

---

## Quick start

```bash
npm install
cp .env.example .env        # then fill in ANTHROPIC_API_KEY and ADMIN_PASSWORD
npm run setup               # migrate + seed the demo "Consumer operations" campaign
npm run dev                 # http://localhost:3000
```

- Console: <http://localhost:3000/console> (sign in with `ADMIN_PASSWORD`).
- Create a campaign, add an interviewee → copy their link → open it to be interviewed.

### Environment (`.env`)

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API key (interview engine + spec drafting). |
| `MODEL` | Model id (default `claude-sonnet-4-6`). Models are configuration (P5). |
| `MODEL_TEMPERATURE`, `MODEL_MAX_TOKENS` | Sampling + output cap. |
| `DATABASE_URL` | SQLite file URL (default `file:./data/app.db`). |
| `BASE_URL` | Public base URL; invite links are `BASE_URL/i/{token}`. |
| `ADMIN_PASSWORD` | Console access (bcrypt-hashed at boot; pilot-grade auth). |
| `RETENTION_DAYS` | Surfaced in the privacy notice. |
| `SESSION_MAX_TURNS` | Hard-stop safety valve for an interview. |
| `SURVEY_URL` | Optional link shown on the closing screen (pilot criterion E5). |

Never commit `.env`. `.env.example` is the template (blank secrets).

---

## Commands

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Develop / build / serve. |
| `npm run setup` | Apply migrations + seed the demo campaign. |
| `npm run db:migrate` / `db:generate` | Apply / generate Drizzle migrations. |
| `npm run seed` | Seed the demo campaign (idempotent). |
| `npm run lint` / `typecheck` / `test` | Static checks + unit/integration tests. |
| `npm run test:e2e` | Playwright end-to-end tests (mocked model). |
| `npm run eval` | Live-model eval harness (§9). Needs `ANTHROPIC_API_KEY`. |

### Testing model

Unit/integration and E2E run with `MOCK_MODEL=1`, a deterministic scripted model, so
gates are reproducible and offline. The **live** model is exercised only by the eval
harness (`npm run eval`).

---

## Architecture

```
/app                 Next.js routes: /(interview) /console /api
/lib
  /engine            interview loop, coverage state machine, tools, model boundary
  /facets            facets.ts — the 12-facet machine spec (single source of truth)
  /spec              renderer + schema validator for the output Markdown
  /db                drizzle schema, migrations, append-only query module
  /eval              simulated informant + A1–A9 assertions
/scripts             migrate, seed, eval harness
/tests               unit, integration, e2e, eval fixtures
/public/brand        VMO2 tokens + Aeonik Pro fonts + logo
/reference           read-only inputs (approved demo, spec, design system)
```

Key flows:

- **Interview engine** (`lib/engine`) — a server loop: user turn → assemble context
  (system prompt + facet spec + transcript + live coverage) → model call with tools →
  the server validates and applies each tool call → agent turn. The model *proposes*
  (`record_statement`, `set_coverage`, `raise_finding`, `end_interview`); the server
  *disposes* (P1). Resume replays persisted state (no in-memory session store).
- **Spec generation** (`lib/spec`) — deterministic frontmatter built in code (the
  model never writes it), per-facet prose drafted from that facet's statements only,
  then validated. An invalid spec blocks completion.
- **Data model** (`lib/db`) — append-only turns + statements (corrections supersede,
  never mutate); one coverage row per session × facet, terminal-only completion.

---

## Operations

### The database is one file

State lives in `data/app.db` (plus `-wal` / `-shm` sidecars in WAL mode). There is no
external datastore. To **back up**, copy the file while the app is quiescent, or use
SQLite's online backup:

```bash
# Simple copy (fine between interviews):
cp data/app.db backups/app-$(date +%F).db

# Consistent online backup while running:
sqlite3 data/app.db ".backup 'backups/app-$(date +%F).db'"
```

To **restore**, stop the app, replace `data/app.db` (remove stale `-wal`/`-shm`), restart.

### Deployment (container)

```bash
docker build -t process-capture .
docker run -p 3000:3000 \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -e ADMIN_PASSWORD=change-me \
  -e BASE_URL=https://your-host \
  -v "$(pwd)/data:/app/data" \
  process-capture
```

The container runs migrations at start, then serves on port 3000. Mount a volume at
`/app/data` so the database survives redeploys. Run `npm run build && npm start` on
Node 20 for a non-container deploy.

### Security posture (pilot-grade)

- Console auth is a single `ADMIN_PASSWORD` (bcrypt-hashed at boot) + an HMAC session
  cookie, with per-IP login rate limiting. Not SSO — an explicit V1 non-goal.
- Security headers (CSP, HSTS, X-Frame-Options, etc.) are set globally; the public
  turn endpoint is rate-limited and length-capped.
- Emails live in the register only, never in specification documents (P7).

---

## Pilot checklist (E1–E5)

| Criterion | How it is met / measured | Where |
|---|---|---|
| **E1** — coverage ≥ 80% answered, zero silent gaps | Every facet ends in a terminal state; a session cannot complete otherwise. Register shows n/12. | coverage state machine; console register |
| **E2** — median session ≤ 40 min | `Session.durationSec` persisted; shown per interviewee in the register. | engine timer; register |
| **E3** — fidelity | Specs are downloadable for process-owner review; conflicts surface as findings. | console register + findings |
| **E4** — ARIS usability | Facet 5 renders as an ordered list with actor/system; the spec schema is validated. | `lib/spec` renderer + validator |
| **E5** — experience | Optional survey link on the closing screen (`SURVEY_URL`). | interview closing screen |

Before the pilot: set `ANTHROPIC_API_KEY`, `ADMIN_PASSWORD`, `BASE_URL`, `SURVEY_URL`;
run `npm run setup`; confirm `npm run eval` passes; back up `data/app.db` on a schedule.

---

## Provenance & principles

Everything captured is **stated** knowledge, attributed to its informant and tagged
`provenance: stated` in every specification — so a later stated-versus-actual
comparison (out of V1 scope) is possible. See `BUILD-REQUIREMENTS.md` §2 for the full
principle set, `DECISIONS.md` for choices taken where the brief was silent, and
`STATUS.md` for the phase-by-phase build log.
