# How the facets are framed, and what gets a facet to green

*The reasoning behind the twelve-facet structure, and the exact condition each
facet has to meet before the rail turns green. For the process architect, and for
anyone who needs to defend why a specification says what it says.*

---

## 1 · The problem the structure solves

A process interview can go two ways, and both fail.

**Ask open questions and listen.** You get a rich, warm account that is
unrepeatable. Two informants on the same process produce two documents with no
common shape, and a modeller cannot put them side by side. Worse, the gaps are
invisible: nobody notices that neither person was ever asked what happens when it
goes wrong, because there was no list saying it should have been.

**Ask a questionnaire.** You get comparable answers and a bored informant who
stops volunteering anything you did not think to ask. Tacit knowledge — the
workaround, the spreadsheet nobody admits to, the approval that formally requires
two signatures and practically requires none — surfaces in digression, and a form
has nowhere for digression to go.

The twelve facets exist to get the comparability of the second without the
deadness of the first. The informant has a conversation. The structure runs
underneath it, unseen by them, and decides what still has to be asked.

**The informant never sees the word "facet."** They see plain-language labels on
a rail — "where it starts", "the part that takes longest" — and a conversation
that behaves like one.

---

## 2 · Three ideas the whole design rests on

### The checklist is the unit, not the facet

A facet is too coarse to score. "Did we cover business rules?" invites a yes when
what was actually captured is a vague gesture at approval thresholds. So each
facet decomposes into **elements** — 40 across the twelve — and each element has
its own condition for being closed.

Green is not a judgement about a facet. It is the arithmetic consequence of every
element beneath it being closed.

### The meter is derived, never authored

The model cannot declare a facet answered. It has no tool for it. It can only
propose that a specific *element* has been captured; the server validates that
proposal, records it, and then recomputes the facet's state from its elements.

This is the single most important structural decision. A model asked "is this
facet complete?" will say yes — it is agreeable by construction, and it has just
spent four turns on the topic. A model asked "has this specific element been
stated?" against a written condition is doing something much narrower and much
harder to fool. And because the facet state is arithmetic, **it cannot claim more
than the checklist can show.**

### Substance is scored, never vocabulary

The informant has never heard of these facets and never will. They are describing
their own job in their own words.

> "it's mostly after the bills land, we get slammed for about a week"

closes *"How often it happens"*. A timing pattern is stated. "Frequency" is our
word, not theirs.

> "there are approval thresholds and governance tiers in place"

does **not** close *"The limits and figures"*. It is full of the right vocabulary
and contains no information: no figure, no level, no role. This is the failure
mode the calibration exists to catch — fluent restatement of the question.

---

## 3 · The five states, and which are one-way

Every facet is in exactly one of five states.

| State | Rail | Meaning |
|---|---|---|
| `pending` | Grey | Not reached |
| `partial` | Yellow | Some elements closed, some outstanding |
| `answered` | Green | Every element closed |
| `unknown_to_informant` | Pink | They said they do not know. A real answer |
| `not_applicable` | — | Does not apply here, with a stated reason |

The last three are **terminal**: once reached, a facet's life is over. That is
what makes "no silent gaps" enforceable rather than aspirational — a session
cannot complete while any facet is `pending` or `partial`, so every facet must
land somewhere final and every landing is recorded.

### The legal moves

```
pending      →  partial, answered, unknown_to_informant, not_applicable
partial      →  answered, unknown_to_informant
answered     →  unknown_to_informant
unknown_to_informant  →  (nothing)
not_applicable        →  (nothing)
```

Everything else is rejected by the server.

Two of these deserve explaining.

**Nothing ever goes backwards.** Evidence is not walked back. A closed element can
be refined but never reopened, so coverage only ever moves forward. Without that,
a late tangent could quietly undo a facet that was properly covered twenty minutes
earlier.

**`answered → unknown_to_informant` is legal, and it is the exception.** It was
added because of a real failure. A rambling informant produced enough adjacent
material for facet 9's elements to close, so the meter derived `answered` — while
the informant's actual position was "risk isn't mine, you want Compliance". The
model tried to correct the coverage, the server rejected it as illegal, and the
specification claimed knowledge nobody had. An honest unknown is strictly more
truthful than derived coverage, so it must be able to override it. The reverse is
never allowed, so the door still only opens one way.

### "I don't know" is not a failure

`unknown_to_informant` is a first-class outcome. When a facet lands there the
server *automatically* raises a retargeting finding — this facet needs someone
else — whether or not the model remembered to. A gap that is recorded, attributed
and routed is worth more than a gap papered over, and infinitely more than a
confident guess.

---

## 4 · What "green" costs, facet by facet

Green requires **every** element closed. An element closes by being captured, or
by being ruled not applicable with a reason the informant gave.

Below: the whole-facet rubric, then the elements and what each one demands.

### Facet 1 — Process identity & context

*Name, purpose, and the start and end boundaries of the process.*  
**Elicitation:** open · **3 elements**

> **Green when:** Purpose is stated, plus both the start and end boundaries.

| Element | Closes when |
|---|---|
| **What the process is for** | The informant has said what the process achieves and why it exists. |
| **Where it starts** | The first thing that happens, or the condition that opens the process. |
| **Where it finishes** | The last thing that happens, or the condition that closes the process. |

### Facet 2 — Stakeholders & resources

*Roles involved, who does what, and the hand-off partners.*  
**Elicitation:** pick-list · role · **3 elements**

> **Green when:** The roles on the main flow are enumerated.

| Element | Closes when |
|---|---|
| **Who is involved** | The roles on the main flow are named as roles, not individuals. |
| **Who does what** | Each named role is tied to what it is responsible for. |
| **Who work passes to and from** | Hand-off partners upstream or downstream are identified, or it is established there are none. |

### Facet 3 — Triggers & events

*What starts the process, and any timing or frequency patterns.*  
**Elicitation:** pick-list · trigger · **4 elements**

> **Green when:** At least the primary trigger is stated, with cadence if there is one.

| Element | Closes when |
|---|---|
| **What sets it off** | At least one initiating trigger is stated. |
| **How it arrives** | The channel or route the trigger comes in by is stated. |
| **How often it happens** | A frequency, cadence, or timing pattern is given, even roughly — or established that there is none. |
| **Other ways it can start** | Secondary or escalation triggers are given, or it is established the primary trigger is the only one. |

### Facet 4 — Inputs & outputs

*What comes in to the process, and what it produces.*  
**Elicitation:** pick-list · io · **4 elements**

> **Green when:** Primary inputs and primary outputs are both stated.

| Element | Closes when |
|---|---|
| **What you need to start** | The primary inputs — information or materials — are stated. |
| **Where those come from** | The origin of the primary inputs is stated. |
| **What it produces** | The primary outputs — what exists at the end that did not before — are stated. |
| **Where the outputs go** | The destination or consumer of the primary outputs is stated. |

### Facet 5 — Workflow & activities

*The ordered steps, actors, systems, decisions, and hand-offs.*  
**Elicitation:** open · **4 elements**

> **Green when:** An ordered account of the main path, including at least one hand-off or decision where any exist.

| Element | Closes when |
|---|---|
| **The steps, in order** | An ordered account of the main path from start to finish. |
| **Who does each step, and where** | Steps are attributed to a role and, where relevant, to a system. |
| **Where the path forks** | At least one decision point is described, or it is established the path never forks. |
| **Where work changes hands** | At least one hand-off is described, or it is established the work stays with one role. |

### Facet 6 — Business rules & decisions

*Rules, approval criteria and thresholds, and decision logic.*  
**Elicitation:** open · **3 elements**

> **Green when:** Rules are stated to their thresholds and levels where approvals exist — probe to £ bands and governance tiers.

| Element | Closes when |
|---|---|
| **The rules you work to** | The rules or criteria governing the main decisions are stated. |
| **The limits and figures** | EVERY band in the escalation ladder is given as a number, not just the first. If they say "I can do £25 myself, above that it goes to a manager", the manager's own limit and whatever sits above it are still outstanding — keep probing until they reach the top of the ladder or say they do not know. "It gets approved" and a single figure are both insufficient. |
| **Who signs off, and at what level** | Every approval tier is tied to the role that holds it, up to the top of the ladder — or established that no approval is required. |

### Facet 7 — Data & information

*Records created or used, and where they live.*  
**Elicitation:** open · **3 elements**

> **Green when:** The key records and the systems that hold them are stated.

| Element | Closes when |
|---|---|
| **What you create or update** | The key records touched by the process are named. |
| **Where each one lives** | Each key record is tied to the system or place that holds it. |
| **Anything kept on the side** | Spreadsheets, shared inboxes or local records outside the main systems are identified, or established that there are none. |

### Facet 8 — Technology & systems

*The systems and tools the process touches.*  
**Elicitation:** pick-list · system · **3 elements**

> **Green when:** The systems on the main path are named.

| Element | Closes when |
|---|---|
| **The systems you use** | The systems and tools on the main path are named. |
| **Whether they talk to each other** | It is established which systems are integrated and where the informant rekeys between them. |
| **The manual bits** | Email, phone, paper or other manual channels in the mix are identified, or established that there are none. |

### Facet 9 — Risk, controls & compliance

*Controls, regulatory obligations, and checks.*  
**Elicitation:** open · **3 elements**

> **Green when:** Controls are stated — or an honest unknown is recorded.

| Element | Closes when |
|---|---|
| **The checks in place** | Checks, sign-offs or quality controls are stated, or established that there are none. |
| **Rules imposed from outside** | Regulatory or formal policy obligations are identified, or established that none apply. |
| **What going wrong looks like** | What counts as an error, and how it would be caught, is described. |

### Facet 10 — Variants & exceptions

*Alternative paths, and what happens when it goes wrong.*  
**Elicitation:** open · **3 elements**

> **Green when:** At least the main exception path is stated.

| Element | Closes when |
|---|---|
| **Cases that go a different way** | At least one alternative path is described, or established that every case follows the same path. |
| **When it goes wrong partway** | What happens on failure or interruption mid-process is described. |
| **The trickiest kind of case** | The hardest case type is described, and how it differs from the usual path. |

### Facet 11 — Performance

*Volumes, durations, and targets.*  
**Elicitation:** open · **3 elements**

> **Green when:** Volume and end-to-end duration are stated, even approximately.

| Element | Closes when |
|---|---|
| **How many you handle** | A volume over some period is given, even approximately. |
| **How long one takes** | An end-to-end duration is given, even as a range. |
| **The target you work to** | A target or SLA is stated, or established that there is none. |

### Facet 12 — Bottlenecks & issues

*The longest task, queues, workarounds, and how standardised the work is.*  
**Elicitation:** open · **4 elements**

> **Green when:** At least one concrete bottleneck is probed (longest task, queue point) and a standardisation read is taken.

| Element | Closes when |
|---|---|
| **The part that takes longest** | A specific longest task or slowest stage is identified. |
| **Where work waits** | A queue or waiting point is identified, or established that work never waits. |
| **Workarounds people use** | Workarounds are described, or established that there are none. |
| **Whether everyone does it the same way** | A read is taken on how consistently the work is done across people. |
---

## 5 · Why these twelve, in this order

The set is not arbitrary and the order is not the order they get asked in.

**Four carry the shape of the process** — 1 identity, 3 triggers, 5 workflow,
6 rules. A specification missing any of these is not much use to a modeller: you
cannot draw a process without knowing what starts it, what happens, in what order,
and under what rules. These are the *mandatory core*, and when the question budget
runs short they are protected first.

**Four describe what it touches** — 2 stakeholders, 4 inputs and outputs, 7 data,
8 systems. These are the nouns: who, what goes in and out, which records, which
systems. They are also the four where different informants most often use
different words for the same thing, which is why three of them are pick-lists.

**Four describe how it behaves in the real world** — 9 risk and controls,
10 variants and exceptions, 11 performance, 12 bottlenecks. This is where the
value for an automation conversation actually sits, and it is the part a
documented process almost never records.

The order is a reading order, not an asking order. Facet 1 first because
everything else needs the boundaries; facet 12 last because you can only discuss
what slows a process down once you know what it is. Within a conversation the
agent follows the informant.

### Open versus pick-list

Eight facets are open. Four — stakeholders, triggers, inputs/outputs and systems —
are pick-lists, because in practice they are closed sets, and asking open questions
about them wastes patience and produces vocabulary that will not reconcile.

"Remedy/Helix", "remedy helix" and "Remedy / Helix" are one system. A pick-list
seeded with the VMO2 taxonomy makes that a tick rather than a spelling. Free text
stays available — the "other, describe it" escape hatch — and what an informant
types becomes a *pending* candidate for the taxonomy, visible to an admin but not
shown to other informants until confirmed.

---

## 6 · How the next question is chosen

Every outstanding element is a candidate. They are ranked, and the agent asks
about the top one unless the conversation makes the second more natural.

| Rank | Tier | Why it sorts there |
|---|---|---|
| 1 | **Conflicting** | An answer contradicts an artefact or another informant. Resolve disagreement before gathering more |
| 2 | **Mandatory core** | Facets 1, 3, 5, 6. The specification is weak without them |
| 3 | **Nearly complete** | One element from closing a facet. A facet closed is a facet the modeller can use |
| 4 | **Remaining** | Everything else |

Terminal facets are excluded entirely — re-asking something the informant has
already disclaimed is exactly the badgering this ordering exists to prevent.

**Why rank at all?** Because interviews get abandoned. The budget is about 25
questions; someone may walk at 14. Ranking means truncation removes the least
important material rather than whatever happened to be last. A cap of three
follow-ups per facet stops a single topic eating the interview.

The informant sees "question N of about M" — a felt horizon, so the conversation
has a visible end. When the budget is exhausted the agent closes warmly and moves
to playback. It is framed as a natural finish, never as a failure to complete.

---

## 7 · The cumulative-element trap

One class of element is not satisfied by a first answer, and it is the most common
way to get coverage wrong.

> Element: **The limits and figures**
> Informant: *"I can do £25 myself, anything above that goes to my manager."*
> → **still outstanding**

One rung is not the ladder. The manager's own limit, and whatever sits above that,
have not been stated. The correct behaviour is to keep climbing — *"and how high
can your manager go?"* — until the informant reaches the top or says they do not
know.

This matters more than it looks. Approval ladders are exactly what a modeller
needs and exactly what people report incompletely, because the first rung is the
only one they use daily. A facet that closed on one figure would produce a
specification that reads as complete and is wrong.

The general rule: **if unsure whether something is captured, it is outstanding** —
but never outstanding merely because the informant did not use the element's own
words.

---

## 8 · Not applicable is a claim, not a default

Marking an element `not_applicable` requires the informant to have indicated it
does not apply, **and a reason in their words**. It is never a way to close
something that simply has not come up.

The reason is carried into the specification's frontmatter as a structured
`not_applicable_items` entry — facet, element, reason. A reader can see not just
that something was skipped, but why, and disagree with it.

If every element of a facet is ruled out, the facet itself becomes
`not_applicable`. That is a legitimate outcome — some processes genuinely have no
regulatory obligations — and it looks nothing like a facet nobody got to.

---

## 9 · What this buys, and what it costs

**Bought:**

- Two specifications for the same process can be read side by side, section by
  section, because both have twelve sections in the same order with explicit
  states.
- No gap is silent. Every facet ends somewhere final, and "unknown" is routed to
  someone who might know.
- Coverage cannot be overstated. The meter is arithmetic over a checklist the
  model cannot write to.
- Truncation is graceful. An abandoned interview keeps the material that matters.

**Paid:**

- The structure is fixed. A process that genuinely needs a thirteenth topic gets
  it recorded in whichever facet is closest, or not at all. Changing the set means
  changing the machine spec, and facet ids are stored on every statement.
- Element conditions are judgements. They are written down and calibrated with
  worked examples, but two readers could disagree at the margin about whether
  "we usually get to it same day" closes *"How long one takes"*.
- Cumulative elements depend on the agent persisting. The instruction is explicit
  and evaluated, but it is a behaviour, not a guarantee.
- Green means **stated**, not **verified**. Every facet closed means every
  question was answered by one person, not that any answer is true. That is what
  `provenance: stated` in the frontmatter means, and it is why conflicts between
  informants are surfaced rather than resolved.

---

## Appendix · The vocabulary

| Term | Meaning |
|---|---|
| **Facet** | One of the twelve fixed topics. `facetId` is a stable key stored on every statement |
| **Element** | A named thing to capture within a facet. 40 in total. The actual unit of coverage |
| **Captured** | An element whose condition has been met by something the informant said |
| **Outstanding** | An element not yet captured. The default |
| **Closed** | Captured *or* not applicable — either way, it no longer needs asking |
| **Terminal** | A facet state that cannot change: answered, unknown to informant, not applicable |
| **Derived** | The facet state, computed from its elements rather than declared |
| **Mandatory core** | Facets 1, 3, 5, 6 — protected when the budget runs short |
| **Retarget finding** | Raised automatically when a facet is unknown: route this to someone who owns it |
