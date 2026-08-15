# Design note — automation assessment (R5.8, proposed)

**Status:** for your decision. Nothing built.
**Date:** 15 August 2026

## What this is for

A stakeholder has read a captured process and wants one question answered:

> Would this process — or some part of it — benefit from AI automation?

They are deciding where to look next, not commissioning a build. So the output is
an **indication with its evidence**, not a design. It has to be honest enough that
acting on it is reasonable and modest enough that nobody mistakes it for approval.

## What already exists, and what is missing

R5.5 labels **each activity** `automatable` / `assistable` / `human-required` /
`unclassified`, with cited facet evidence and a server rule that a confident label
must cite something. That is the raw material and it is sound.

Three things are missing for the question above:

| Missing | Why it matters to a stakeholder |
|---|---|
| A **whole-process** verdict | "Nine of nineteen steps are automatable" is not an answer. Whether the *process* is worth pursuing is. |
| **Segments** | Automation rarely lands on one step. Value is in contiguous runs — "steps 4–8 are all system work on data we already hold". |
| A **readout** rather than an overlay | Badges on a diagram serve an architect. A stakeholder needs a page they can take into a meeting. |

## The shape I propose

### Three levels, from evidence upward

1. **Activity** — exists (R5.5). Unchanged.
2. **Segment** — contiguous activities on the flow that would be automated as one
   unit. **Derived deterministically in server code**, by walking the flow and
   grouping adjacent activities that share a compatible label and stay within one
   lane or cross a hand-off that automation would remove. The model does not get to
   invent segments; it only describes ones the graph supports. This keeps P1
   intact and makes every segment explainable — you can point at the steps.
3. **Process** — one verdict for the whole thing, with reasons.

### The process verdict

Four values, and the fourth is not a failure:

| Verdict | Meaning |
|---|---|
| `strong-candidate` | A large, contiguous share of the work is deterministic system work with the data available. |
| `partial-candidate` | Specific segments are worth pursuing; the process as a whole is not. |
| `poor-candidate` | Judgement, authority or physical presence dominate. Automation would touch the edges. |
| `insufficient-evidence` | The capture does not support a judgement. **Says what is missing and who would know.** |

The last is the one that makes the other three trustworthy. A tool that always
finds an opportunity is a tool nobody should believe.

### What each segment carries

Everything a stakeholder needs to decide whether to look further, and nothing that
pretends to be a design:

- **Which steps**, by name, so it can be pointed at on the map
- **What kind** — full automation, assisted, or not viable
- **Coverage** — how many of the process's steps it covers, and its share of
  end-to-end duration where facet 11 gave us one
- **Why**, in two sentences, citing the facets that support it
- **What must be true first** — the integration, data or policy precondition
- **What stays human**, and why
- **Confidence**, with what would raise it

Deliberately absent: cost, savings, headcount, timelines, vendor or tool choices.
We have no data for any of them, and a number invented here would be quoted back
as though it were measured.

## How it is presented

A new **Automation assessment** tab beside the map, and a download.

- The verdict, in one sentence, with the count of steps assessed
- A ranked list of segments — largest coverage first
- A **What we could not judge** section: the `unclassified` share, and the specific
  questions that would close it
- A standing caveat: proposed, unverified, derived from one informant's account

The download is the artefact that goes to stakeholders. It should read like the
one-pagers we have been producing: a page they can act on.

## Rules it inherits

Non-negotiable, and the same ones that govern the rest of R5:

- **No confident claim without cited evidence.** `unclassified` may cite nothing
  but must explain itself. On failure, the model downgrades rather than inventing a
  citation.
- **Server disposes.** Segments are derived in code. The model describes and
  assesses; it does not decide what is adjacent or what counts as a segment.
- **Attribution survives.** Every claim traces to a facet, and through it to a
  named informant's statement.
- **Nothing reaches a handover report unverified.** It goes through the same R5.4
  per-item gate as to-be changes and opportunity labels.
- **One informant is one account.** Where several people described the same
  process, the assessment says so and does not merge them.

## Scope boundaries

**In:** assessing a captured process, indicating where automation would help, and
saying why with evidence.

**Out:** designing the automation, specifying agents or tools, estimating cost or
benefit, and anything that reads as a recommendation to proceed. This is
`proposed`, like everything else past the specification.

## What it would take

Roughly two to three days:

- `lib/graph/segments.ts` — deterministic segment derivation from the graph and the
  existing classifications. Pure function, heavily tested; this is the part that has
  to be right.
- `lib/graph/assessment.ts` — one forced-tool model call producing the process
  verdict and the per-segment prose, validated server-side against the derived
  segments so it cannot describe a segment that does not exist.
- A route, a tab, and the download.
- Tests, including the case that matters most: a process where the honest answer
  is `poor-candidate` or `insufficient-evidence`, and the assessment says so.

## Two things I would like you to decide

1. **Is `insufficient-evidence` acceptable as a headline verdict?** I think it is
   essential, but it means some stakeholders will open the artefact and find no
   answer. That is the honest outcome when one interview cannot carry the judgement,
   and I would rather it be visible than quietly rounded up to `poor-candidate`.

2. **Should the assessment span informants, or stay per interview?** Per interview
   is simpler and consistent with everything else — one account, attributed. Across
   informants is more useful to a stakeholder but needs a view of the same process
   from several people, and raises the question of what to do when they disagree.
   My instinct is to ship per interview and add the cross-informant view once the
   conflict fixture exists.
