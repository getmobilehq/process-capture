# Prompt — harvest a full process record from concept-to-market sources

Give this to a Claude Code project that has access to the concept-to-market (C2M)
end-to-end delivery material: process flows, data-point catalogues, system
inventories, and workshop transcripts.

Its output is the input to as-is documentation, to-be re-engineering, and an
automation assessment. It is written to be **machine-ingestible**: the JSON blocks
map onto a process-graph schema, so the answer can be turned into diagrams and
specifications without a human retyping it.

Everything below the line is the prompt. It is deliberately client-agnostic — add
the organisation, programme and scope names in the placeholders at the top.

---

You are a process analyst working from primary sources. You have access to a
corpus covering an end-to-end concept-to-market delivery capability: process
flows, data-point definitions, system inventories, and transcripts of workshops
with the people who run the work.

Your task is to produce a **complete, attributed process record** for:

- **Organisation / programme:** `<FILL IN>`
- **Process in scope:** `<FILL IN — e.g. "Concept to market, end to end" or a named sub-process>`
- **Boundaries:** `<FILL IN — where it starts, where it ends, what is explicitly out>`

That record will be used for three things, so it must carry enough evidence for
all three: documenting the **current state**, re-engineering a **future state**
in which automation and agentic AI are fully applied, and **justifying each
automation decision** against evidence a reviewer can check.

## How to work

Search the corpus exhaustively before writing anything. Prefer transcripts over
diagrams where they disagree — a diagram records what was designed, a transcript
records what people actually do, and the gap between them is itself a finding.
Read whole documents, not extracts, where the document is short enough to matter.

Do not stop at the first source that answers a question. For each element below,
look for corroboration and for contradiction.

## Non-negotiable rules

These are the difference between a usable record and a plausible one. Violating
any of them makes the output unusable downstream.

1. **Attribute everything. Average nothing.** Every statement carries its source:
   document name or transcript, and the speaker and their role where known. Where
   two sources disagree, record **both** as separate statements and raise a
   conflict. Never merge them into a consensus, never split the difference, never
   pick the one that sounds more authoritative.

2. **No silent gaps.** Every element listed below ends in exactly one state:
   `answered`, `unknown` (the corpus does not say), or `not_applicable` (it does
   not apply, and you can say why). An element you did not investigate is not
   `not_applicable` — it is `unknown`. A record that quietly omits what it could
   not find is worse than one that names the hole.

3. **No claim without a citation.** Every statement points at the source that
   supports it. If you are inferring rather than reporting, say so explicitly and
   mark it `inferred`. An inference presented as a finding is a defect.

4. **Complete every ladder.** Where a threshold, tier, approval level or band is
   mentioned, capture **every rung**, not the first. "Under £5k the manager signs
   it off, above that it escalates" is incomplete until you have who signs at each
   level all the way to the top, or an explicit statement that the corpus does not
   say. The same applies to severity tiers, priority bands, and stage gates.

5. **Quote verbatim where the wording carries meaning.** Rules, thresholds,
   obligations and complaints about the process should be quoted, not paraphrased.
   Paraphrase loses the hedge, and the hedge is often the point.

6. **Distinguish the designed process from the practised one.** Where a transcript
   describes a workaround, a shadow spreadsheet, or "what we actually do", record
   it as such and mark it `practised`. Mark documented-but-unconfirmed steps
   `designed`.

## Part A — the twelve facets

Cover every element. For each, give: the state (`answered` / `unknown` /
`not_applicable`), the statements with their sources, and — where the element is
unknown — what would have to be found to close it.

**F1 · Process identity and context**
- `identity.purpose` — what the process achieves and why it exists
- `identity.start` — the first thing that happens, or the condition that opens it
- `identity.end` — the last thing that happens, or the condition that closes it

**F2 · Stakeholders and resources**
- `stakeholders.roles` — the roles on the main flow, named as roles, not individuals
- `stakeholders.responsibilities` — each role tied to what it is responsible for
- `stakeholders.handoffs` — upstream and downstream hand-off partners

**F3 · Triggers and events**
- `triggers.initiating` — what sets the process off
- `triggers.channels` — the route or channel a trigger arrives by
- `triggers.timing` — frequency, cadence, seasonality
- `triggers.secondary` — escalation or alternative triggers

**F4 · Inputs and outputs**
- `io.inputs` — what is needed to start
- `io.sources` — where those inputs come from
- `io.outputs` — what exists at the end that did not before
- `io.destinations` — who or what consumes the outputs

**F5 · Workflow and activities**
- `workflow.steps` — an ordered account of the main path, start to finish
- `workflow.actors` — each step attributed to a role and, where relevant, a system
- `workflow.decisions` — every point where the path forks, and on what criterion
- `workflow.handoffs` — every point where work changes hands

**F6 · Business rules and decisions**
- `rules.governing` — the rules and criteria governing the main decisions
- `rules.thresholds` — every band, limit and figure, as numbers (see rule 4)
- `rules.approvals` — every approval tier tied to the role that holds it

**F7 · Data and information**
- `data.records` — the key records created or updated
- `data.location` — the system or place that holds each record
- `data.shadow` — spreadsheets, shared inboxes, local files outside the main systems

**F8 · Technology and systems**
- `systems.named` — every system and tool on the main path
- `systems.integration` — which systems are integrated, and where people rekey between them
- `systems.manual` — email, phone, paper, meetings and other manual channels

**F9 · Risk, controls and compliance**
- `risk.controls` — checks, sign-offs and quality controls
- `risk.obligations` — regulatory or formal policy obligations
- `risk.failure` — what counts as an error, and how it is caught

**F10 · Variants and exceptions**
- `exceptions.variants` — cases that follow a different path, and what distinguishes them
- `exceptions.failure` — what happens on failure or interruption mid-process
- `exceptions.hardest` — the hardest case type and how it differs

**F11 · Performance**
- `performance.volume` — volume over a period
- `performance.duration` — end-to-end duration, as a range if that is all there is
- `performance.target` — the target, SLA or stage-gate commitment

**F12 · Bottlenecks and issues**
- `bottlenecks.longest` — the slowest stage or longest task
- `bottlenecks.queues` — where work waits, and what it waits for
- `bottlenecks.workarounds` — the workarounds people actually use
- `bottlenecks.standardisation` — how consistently the work is done across people and teams

## Part B — the process structure

Emit a JSON block that describes the process as a graph. Every element carries
`sourceFacet` — the facet number the evidence came from — so any node can be
traced back to a statement. Where the corpus does not support a node, do not
invent one to make the diagram tidy.

```json
{
  "processId": "kebab-case-id",
  "name": "Process name",
  "lanes": [
    { "id": "lane:<role>", "name": "Role or team", "sourceFacet": 2 }
  ],
  "events": [
    { "id": "ev:start", "type": "start", "name": "What opens it", "laneId": "lane:x", "sourceFacet": 3 },
    { "id": "ev:end", "type": "end", "name": "What closes it", "laneId": "lane:x", "sourceFacet": 1 }
  ],
  "activities": [
    {
      "id": "act:<verb-noun>",
      "name": "Do the thing",
      "laneId": "lane:x",
      "systems": ["System A", "System B"],
      "sourceFacet": 5
    }
  ],
  "gateways": [
    {
      "id": "gw:<decision>",
      "type": "exclusive",
      "name": "The question being asked",
      "condition": "The criterion, quoted where possible",
      "laneId": "lane:x",
      "sourceFacet": 6
    }
  ],
  "flows": [
    { "id": "f1", "from": "ev:start", "to": "act:first", "condition": "optional label" }
  ],
  "annotations": [
    {
      "id": "ann:1",
      "targetId": "act:something",
      "kind": "bottleneck",
      "text": "What is wrong here, in the informant's terms",
      "evidence": { "facet": 12, "quote": "verbatim", "source": "workshop-3, Ops Lead" }
    }
  ]
}
```

`kind` is one of `bottleneck`, `risk`, `metric`. Annotate generously — these are
what the future-state work acts on, and an unannotated activity is one nobody can
justify changing.

## Part C — the automation evidence

This part exists so that a future-state design can be **argued**, not asserted.
For **every activity** in Part B, gather the evidence that determines whether it
could be automated. Do not classify yet if the evidence is thin — say so.

For each activity give:

- **Inputs and outputs** — what it consumes, what it produces, and in what form
  (structured record, free text, conversation, document, judgement)
- **Determinism** — is the output a function of the input, or does it require
  judgement? Quote the rule if there is one
- **Data availability** — does a system already hold what is needed, or does a
  person fetch, retype or reconcile it?
- **System reach** — do the systems involved expose APIs, or is this screen work?
  Say if unknown
- **Authority** — does anyone have to approve, sign, or be accountable? At what level?
- **Regulatory or contractual constraint** — anything requiring a human by rule
- **Volume and cycle time** — how often, and how long it takes
- **Error modes** — what goes wrong, how it is detected, what it costs
- **Variation** — do different people do it differently, and why

Then give a **provisional label** with its reasoning:

| Label | Meaning |
|---|---|
| `automatable` | Deterministic, data already held or exposed, no judgement or approval authority required |
| `assistable` | A system could do most of it but a person keeps the decision — drafting, pre-filling, suggesting |
| `human-required` | Approval authority, physical presence, relationship, or a regulatory obligation |
| `unclassified` | The corpus does not say enough. **State exactly what is missing.** |

**A label with no cited evidence is invalid.** Only `unclassified` may cite
nothing, and it must explain itself. If the evidence will not carry a confident
label, downgrade to `unclassified` — do not invent a citation to make a label
stand up. An honest "we do not know whether this system has an API" is actionable;
a confident label that turns out to be wrong is worse than no label.

For each `automatable` or `assistable` activity, also give:

- **What the automation would have to do**, in one or two sentences
- **Preconditions** — what must be true first (integration, data quality, a policy
  change, a decision someone has to make)
- **What remains human** afterwards, and why
- **Expected effect** — tied to the volume, cycle time or error rate you recorded,
  not to a generic claim about efficiency

Where an **agentic** approach is warranted — a system that plans across several
steps, calls tools, and handles variation rather than following a fixed script —
say so explicitly and say what makes it agentic rather than a rule or a script.
Be sparing: most of what looks agentic is a workflow with better data.

## Part D — conflicts, gaps and open questions

Three lists, kept separate because they need different actions.

1. **Conflicts** — where sources disagree. Give both accounts, both sources, and
   what turns on the difference. Do not resolve them.
2. **Gaps** — every element marked `unknown`, with what would close it and who
   would likely know.
3. **Questions for a human** — decisions the corpus cannot settle: policy choices,
   ownership questions, anything where the right answer is a judgement rather than
   a fact.

## Output format

1. A short preamble: what you read, what you could not access, and how confident
   you are overall.
2. **Part A** as structured markdown, facet by facet, element by element.
3. **Part B** as a single fenced `json` block.
4. **Part C** as one section per activity, then a summary table of the labels with
   counts and the share you left `unclassified`.
5. **Part D** as three lists.

British English throughout. Sentence case. Spaced en-dashes. No emoji.

## Before you return

Check your own output against these, and fix what fails:

- Does every element have a state, and does every `answered` element have at least
  one citation?
- Is every threshold ladder complete to the top, or explicitly marked incomplete?
- Does every node in Part B carry a `sourceFacet`?
- Does every confident label in Part C cite evidence?
- Have you preserved every conflict rather than resolving one?
- Is anything asserted that you inferred without marking it `inferred`?
- What is the single weakest claim in this document, and have you said so?

State the `unclassified` share explicitly. A high proportion is a legitimate
finding about the corpus — it tells the reader where to send someone to ask. A
low proportion achieved by guessing is a failure that will not be visible until
someone acts on it.
