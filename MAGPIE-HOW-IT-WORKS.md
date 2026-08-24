# Magpie — what it is and how it works

*For the process architect. Written to be read end to end in about twenty
minutes, and then kept as a reference.*

---

## 1 · The problem it was built for

VMO2's processes are largely tacit. They are held in the heads of the people who
run them, and they surface only in fragments — a workshop, a hand-off note, an
exception nobody documented. Getting them into ARIS means getting them out of
people first, and that is the expensive part: a modeller's time, a diary, a room,
and a conversation that has to be repeated for every person who knows a piece of
it.

Magpie does that conversation. It runs a structured interview with one person
about one process, and produces a written specification of what **that person**
said — attributed to them, provenance-tagged, and shaped so a modeller can draft
from it.

It is not an ARIS replacement, and it does not produce a model. It produces the
input a modeller currently has to gather by hand.

---

## 2 · The one idea to hold on to

**Magpie captures accounts, not truth.**

Everything in a specification is what a named person said, on a named date, about
a process as they understand it. If two people describe the same process
differently, Magpie does not decide who is right, does not merge the two, and does
not average them. It records both, attributes both, and raises the disagreement as
something for you to look at.

That is a deliberate constraint, and most of the design follows from it. When you
find yourself asking "why doesn't it just…", the answer is usually this.

---

## 3 · The two faces

One application, two audiences.

### The process user — a tokenised link

The person who does the work receives a link (`/i/<token>`). No account, no
password, no training. They confirm who they are, then have a conversation. The
interview takes **25 to 40 minutes**, and it is designed to be finished in one
sitting — though it can be resumed if they close the tab.

### The process architect — the console

You sign in at `/console` with a named account. From there you create campaigns,
name the processes in scope, add informants, issue links, watch the register fill
up, and read what comes back.

---

## 4 · What the interview actually is

An agent asks one question at a time, in plain language, and listens. It is not a
form. It follows what the person says, asks the obvious follow-up, and moves on
when a topic is genuinely covered.

Underneath, it is working through **twelve facets** — the fixed structure that
makes one interview comparable with another.

| # | Facet | What it is after | How it asks |
|---|---|---|---|
| 1 | Process identity & context | Name, purpose, start and end boundaries | Open |
| 2 | Stakeholders & resources | Roles involved, who does what, hand-off partners | Pick-list |
| 3 | Triggers & events | What starts it, timing and frequency | Pick-list |
| 4 | Inputs & outputs | What comes in, what it produces | Pick-list |
| 5 | Workflow & activities | The ordered steps, actors, systems, decisions, hand-offs | Open |
| 6 | Business rules & decisions | Rules, approval criteria, thresholds, decision logic | Open |
| 7 | Data & information | Records created or used, and where they live | Open |
| 8 | Technology & systems | The systems and tools the process touches | Pick-list |
| 9 | Risk, controls & compliance | Controls, regulatory obligations, checks | Open |
| 10 | Variants & exceptions | Alternative paths, and what happens when it goes wrong | Open |
| 11 | Performance | Volumes, durations, targets | Open |
| 12 | Bottlenecks & issues | Longest task, queues, workarounds, how standardised the work is | Open |

**Open** facets are answered in the informant's own words. **Pick-list** facets
offer known options — the VMO2 systems taxonomy is pre-seeded, so "Xenia" or
"Remedy/Helix" is a tick rather than a spelling — with an "other, describe it"
escape hatch. That is what keeps vocabulary consistent across informants without
forcing anyone into a menu.

Each facet has named **elements** beneath it (facet 1 has three: what the process
is for, where it starts, where it finishes). The informant can expand a facet on
the coverage rail at any time and see, in plain language, what is still
outstanding.

### The coverage rail

Down the side of the interview is a rail showing all twelve facets and their
state:

| Colour | State | Meaning |
|---|---|---|
| Grey | Pending | Not reached yet |
| Yellow | Partial | Started, not yet substantively covered |
| Green | Answered | Covered |
| Pink | Unknown to informant | They said they do not know — a legitimate answer |
| — | Not applicable | Does not apply to this process, with a stated reason |

**An interview cannot finish while any facet is pending or partial.** Every one of
the twelve must land on one of the three terminal states. This is the "no silent
gaps" rule, and it is enforced by the server, not by the agent's good intentions.

"I don't know" is a first-class answer. It is recorded as such, attributed, and
appears in the specification — because the fact that the person running the
process does not know something is itself a finding worth having.

### Voice

The informant can speak rather than type. Transcription runs inside VMO2's own
Google Cloud project via Vertex AI, so the audio does not leave the project.

---

## 5 · What the architect does, step by step

### 5.1 Create a campaign

A campaign is one engagement: a department and a set of processes you want
captured. Add the **target processes** by name — these are what informants get
routed to. Processes can be archived later without losing what was captured
against them.

### 5.2 Add informants and issue links

Add each person with their name, work email address and role. Magpie mints a
unique tokenised link per person. Send it however you normally would.

> Email addresses live in the register only. They are never written into a
> specification document — that is enforced in code, not by convention.

### 5.3 Watch the register

The register shows every informant, the process they were routed to, and their
status: invited, in progress, complete. This is the view to keep open while a
campaign is running.

### 5.4 Read what comes back

Each completed interview produces a specification. Open it from the register.

---

## 6 · The specification

One document per informant, per process. Markdown, downloadable, and structured
identically every time.

### The header

Machine-readable frontmatter, built by code — the model never writes it:

```yaml
process_name: "Handling a billing complaint"
department: "Consumer operations"
informant: {name: "Priya Nair", role: "Complaints advisor"}
interviewed: 2026-08-12
duration_min: 34
provenance: stated
coverage: {answered: 10, unknown: 1, not_applicable: 1, ...}
not_applicable_items: [...]
open_items: [...]
```

`provenance: stated` is the important line. It means: this is an account, given by
this person, on this date. Nothing in the document has been verified against a
system, a policy, or another informant.

### The body

Twelve sections, one per facet, always in the same order, each carrying its
terminal state in the heading. Under each: what the informant said, with the
outstanding elements named if any were left open.

Because the shape is fixed, two specifications for the same process by different
people can be read side by side, section by section. That is the point.

### Corrections

If an informant corrects themselves mid-interview, the original statement is not
overwritten. It is superseded — the new statement supersedes the old one, and both
remain in the record. Nothing that was said is deleted.

---

## 7 · Findings — where disagreement surfaces

Magpie raises a **finding** rather than resolving anything itself. Three kinds:

| Kind | What it means |
|---|---|
| **Candidate conflict** | Two informants have described the same thing differently |
| **Unknown retarget** | An informant did not know something; here is who probably would |
| **Informant flag** | The informant themselves flagged something as wrong, risky or contested |

Findings appear in the console under the campaign. They are worked by a person —
you — not closed automatically. A conflict between two accounts is usually the
most valuable thing a campaign produces: it is the place where the documented
process and the real one have come apart.

---

## 8 · The process map

From a completed specification, Magpie can draw a **BPMN 2.0 process map** — lanes
for the roles, tasks for the steps, gateways for the decisions, drawn from what the
informant described at facets 5, 6 and 10.

- It is viewable in the console, expandable to full screen, and you can drag
  elements to rearrange them. A saved layout keeps the drawing only — it never
  changes the specification or the evidence beneath it.
- It exports as **`.bpmn`** (opens in ARIS, Camunda, Signavio, bpmn.io) and as
  **`.svg`** for slides.

The map is a reading aid drawn from one person's account. It is not a validated
model, and the export carries that provenance with it.

---

## 9 · The analysis layers

Four optional views, each answering a different question. All of them are
**proposals**, and all of them say so on their face.

### 9.1 Opportunity overlay

Classifies each step as `automatable`, `assistable`, `human-required` or
`unclassified` — with cited evidence. `unclassified` is the honest answer when the
capture does not support a judgement, and it is used rather than guessed at.

### 9.2 Automation assessment

A verdict on the process as a whole: **strong candidate**, **partial candidate**,
**poor candidate**, or **insufficient evidence** — plus a one-sentence headline a
stakeholder can read on its own.

The verdict is checked against the arithmetic. If the numbers do not support the
claim, the server rejects it and makes the model choose again. A tool that always
finds an opportunity is a tool nobody should believe, so the gate exists to stop
over-claiming — never to stop under-claiming.

It will never state a cost, a saving, a headcount, a timeline, a vendor or a tool.
There is no data for any of those, and a number invented here would be quoted back
as though it had been measured.

### 9.3 Autonomy levels

Each step placed on a four-point scale, with a colourful swimlane you can export
as a **PDF** for a pack:

| Level | Meaning |
|---|---|
| **L3** | Agent runs it autonomously |
| **L2** | Agent executes, human verifies |
| **L1** | Agent assists, human executes |
| **L0** | Human only — by nature or by design |
| **?** | Not enough evidence to place this step |

Each step also carries what would have to change to reach the next level up.

### 9.4 To-be map

A proposed future-state map, generated as a **change-set** against the as-is: each
change described and justified separately, rather than a new diagram appearing from
nowhere.

**The verification gate.** A to-be map is `proposed` and unverified until a human
has ruled on **every** change — approve, edit, or reject. Only a fully reviewed
change-set may go into a handover report. Reviews are recorded against the named
reviewer. Until then the view is labelled unverified everywhere it appears.

---

## 10 · What it will not do, on purpose

Worth knowing before you ask it to.

- **It will not merge two informants' accounts.** Two people, two specifications.
  Differences become findings.
- **It will not average anything.** No "most people said". Numbers belong to the
  person who gave them.
- **It will not let an interview end with a gap.** Every facet reaches a terminal
  state or the interview does not complete.
- **It will not invent structure.** The model proposes; the server validates and
  applies. The specification's shape, the coverage state and the provenance line
  are all owned by code the model cannot write to.
- **It will not present analysis as fact.** Proposed stays proposed until a person
  has signed it off, and the label is generated structurally, not by prompt.
- **It will not put an email address in a specification.**
- **It will not quantify a saving.** See §9.2.

---

## 11 · Privacy and retention

- Interview content is a named person's account of their own job, held with their
  work email address in the register.
- **Retention**: content is deleted a set number of days after a session finishes
  — 365 by default. A session going takes everything beneath it: transcript,
  statements, coverage, drafts, specifications, maps, reviews, findings. An
  informant record goes once they hold no sessions at all, which is what removes
  the email address. Campaigns are never touched; they hold no personal data.
- **Specifications are deleted with their session.** The handover to the modeller
  is the export, and it is expected to happen well before the window closes. If
  specifications should outlive transcripts, that is a policy decision to state —
  it is not the current behaviour.
- **No telemetry and no monitoring of informants.** The system stores statements,
  not behaviour.

---

## 12 · A campaign, end to end

1. **Scope it.** Which processes, and who knows them. Two or three informants per
   process is where conflicts start to be informative.
2. **Create the campaign** and name the target processes.
3. **Add informants**, issue links, tell people it takes 25–40 minutes and is best
   done in one sitting.
4. **Watch the register.** Chase the ones that stall.
5. **Read the specifications** as they land, not all at the end.
6. **Work the findings.** Conflicts first — they are the highest-value output.
7. **Open the process map** for the ones you will model. Export `.bpmn` and draft
   into ARIS from it.
8. **Run the analysis layers** if the conversation is about automation. Review the
   to-be change-set properly if it is going anywhere near a stakeholder.
9. **Export before the retention window closes.**

---

## 13 · Honest limits

- **One informant, one account.** A specification is not a validated process. It is
  what one person said. Treat it as evidence, not as a model.
- **The maps are drawn from description**, so they are as good as the description.
  A vague facet 5 gives a vague map.
- **The analysis layers are proposals** and are labelled as such. The automation
  assessment is checked against its own arithmetic, but "the numbers permit this
  verdict" is not the same as "this is worth doing".
- **Conflicts are surfaced, not resolved.** That work is yours, and it is the work
  that needs a person.
- **Volumes, durations and targets are as reported.** Nobody has checked them
  against a system.

---

## Appendix · Glossary

| Term | Meaning |
|---|---|
| **Campaign** | One engagement: a department, a set of target processes, a set of informants |
| **Target process** | A named process in scope; informants are routed to one |
| **Informant** | The person interviewed. Also "process user" |
| **Session** | One informant's interview about one process |
| **Facet** | One of the twelve fixed topics an interview covers |
| **Element** | A named thing to capture within a facet |
| **Coverage state** | Where a facet stands: pending, partial, answered, unknown to informant, not applicable |
| **Statement** | One thing an informant said, attributed and timestamped |
| **Finding** | Something needing a human: a conflict, a retarget, or a flag |
| **Specification** | The Markdown document produced from one session |
| **Provenance: stated** | This is an account, from this person, on this date — not verified |
| **As-is map** | BPMN drawn from what was described |
| **To-be map** | A proposed future state, as a reviewable change-set |
| **Change-set** | The individual proposed changes, each approved, edited or rejected by a named reviewer |
| **Verified** | Every change in a change-set has been ruled on by a person |
| **Register** | The list of informants in a campaign and their status |
