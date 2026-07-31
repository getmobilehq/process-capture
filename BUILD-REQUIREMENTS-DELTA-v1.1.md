# BUILD-REQUIREMENTS delta — v1.1

**Project:** VMO2 Enterprise Process Capture tool
**Status:** Post-pilot iteration. Baseline is BUILD-REQUIREMENTS.md v1.0 and the shipped V1 app. This delta captures requirements from the manager pilot test (31 Jul 2026) plus the process visualisation feature agreed 31 Jul 2026.
**Instruction to Claude Code:** Treat this document as additive to v1.0. Where this delta conflicts with v1.0, this delta wins. Append every material design decision you take to DECISIONS.md (append-only). Update STATUS.md as each requirement lands. Do not begin R5 until R5.1 (typed process graph) has passed its eval fixtures.

---

## Context

The V1 tool conducts a structured conversational interview against the Simplified Process Facets framework (12 facets) and produces a process specification markdown document with YAML front-matter (see fixture: `spec-fault-management-process-v1.md`). The pilot surfaced six improvement areas; process visualisation (R5), suggested responses (R8), and the bounded interview (R9) were agreed subsequently. Stack is unchanged: Next.js + SQLite + Drizzle + Anthropic API, single-tenant deployment, VMO2 design system (Aeonik Pro, O2 Blue #0050FF, Virgin Media Red #E10A0A, Hot Pink #FF0090).

Priority order: **R1 → R2 → R10 → R9 → R5 → R8 → R4 → R3 → R6**. R7 is backlog, do not build.

---

## R1 — Completeness scoring: transparency and tolerance (P0)

**Problem observed.** The per-facet completeness meter stalls on amber for substantively complete answers phrased in natural language, and only turns green when the interviewee uses the facet's own vocabulary ("triggers", "events", "systems"). The interviewee cannot see what the system still wants. This penalises natural speech, rewards keyword-shaped answers, and corrupts evidence quality — a green facet must mean the content was captured, not that the right words were said.

**R1.1 — Facet checklist visibility.** Each facet gets a visible checklist of its expected elements (e.g. Triggers & events: initiating trigger(s); channels; timing/frequency pattern; secondary/escalation triggers). Each element shows one of three states: captured (with a one-line summary of what was captured), outstanding, or marked not-applicable by the interviewee. The meter is derived from the checklist — never a bare percentage. The interviewee must always be able to answer "what is it still looking for?" by looking at the screen.

**R1.2 — Content-based scoring.** Rewrite the completeness-assessment prompt to evaluate whether each checklist element is *substantively answered*, explicitly independent of vocabulary. Include contrastive few-shot pairs in the prompt: natural-language answers that must score as captured, and keyword-rich but vacuous answers that must score as outstanding.

**R1.3 — Not-applicable path.** The interviewee (or interviewer) can mark any checklist element N/A with a short reason. N/A closes the element and is recorded in the spec front-matter `coverage` block (the schema already carries `not_applicable`).

**Acceptance.**
- Feeding the fault-management interview content paraphrased into plain language (no facet vocabulary) produces ≥ the same coverage result as the original.
- A keyword-stuffed answer with no substance leaves elements outstanding.
- At any point mid-interview, the UI displays per-facet outstanding elements in plain language.

---

## R2 — Deterministic facets as pick-lists (P0)

**Problem observed.** Several facets are closed sets in practice. Asking open questions for them wastes interviewee patience and produces inconsistent vocabulary across interviews.

**R2.1 — Hybrid elicitation.** Classify facets by elicitation mode:
- **Open (probabilistic):** purpose/context, workflow & activities, business rules, exceptions, bottlenecks.
- **Pick-list (deterministic):** triggers & events, technology & systems, inputs & outputs, stakeholder roles.

For pick-list facets, present a selectable option set ("which of these apply? tick all that apply") with an "other — describe" escape hatch. Free-text answers to pick-list facets are still accepted and mapped onto options where possible.

**R2.2 — Option-set seeding.** Option sets are seeded from, in priority order: (a) an org-level taxonomy table (admin-editable; pre-seed the systems list from the fixture spec — OmniEngage, iComms, Xenia, Einstein, CSRD/Netcracker 360, IK, Remedy/Helix, dialler/IVR); (b) entities already mentioned earlier in the current interview; (c) entities from prior interviews in the same engagement. Every seeded option carries its source.

**R2.3 — Vocabulary normalisation.** Selections write canonical entity IDs into the spec, not free text, so cross-interview contribution analysis matches entities reliably. Free-text "other" entries create new canonical entities pending admin confirmation.

**Acceptance.** An interview reaching facet 8 (systems) after systems were named in facet 4 shows those systems pre-ticked with source attribution; the interviewee confirms rather than re-lists.

---

## R3 — Artefact ingestion (P1)

**Problem observed.** Interviews alone miss evidence that already exists — email threads, meeting transcripts, existing documents. The legal-process example: transcript + email trail + output documents should combine into one view.

**R3.1 — Upload surface.** Per interview session, allow upload of: .docx, .pdf, .txt/.md (covers exported email threads and transcripts). Extract text server-side (mammoth for docx; pdf text extraction; plain read for txt/md). Reject other formats with a clear message.

**R3.2 — Provenance classes.** Extend the provenance model beyond `stated`:
- `stated` — interview answers (existing)
- `documented` — content from uploaded artefacts
- `corroborated` — a claim present in both an interview answer and an artefact
- `conflicting` — interview and artefact disagree

Every claim in the generated spec carries exactly one provenance class. Conflicts are never silently resolved: they are queued as targeted follow-up questions (see R4) and, if unresolved, surfaced in the spec's open items.

**R3.3 — Interview remains primary.** Artefacts corroborate and fill gaps; they do not auto-populate checklist elements to captured without either interview confirmation or explicit admin acceptance. (This preserves the interview-first position for VMO2 while borrowing the evidence-first mechanic: generation never runs ahead of evidence.)

**R3.4 — Data handling.** Uploaded artefacts inherit the engagement's retention and destruction terms. Record filename, uploader, timestamp, and a content hash for every artefact.

**Acceptance.** Uploading a document naming a system not mentioned in interview yields a `documented` claim plus a queued follow-up ("the uploaded doc mentions X — is that part of this process?"); confirming it upgrades the claim to `corroborated`.

---

## R4 — Adaptive follow-ups: fewer, smarter questions (P1)

**Problem observed.** Interviewees want to talk freely and be asked one or two sharp clarifiers, not walked through a questionnaire. Impatience is the enemy; the interview must feel like a competent human listener.

**R4.1 — Free-narration mode.** The interviewee can speak/write at length without facet-by-facet prompting. After each substantial answer, the system re-scores *all* facet checklists against the full session transcript (not just the current facet) — an answer about workflow may close elements in systems, stakeholders, and rules simultaneously.

**R4.2 — Question budget and selection.** After narration, ask at most two follow-ups per turn, selected by information value: (1) `conflicting` provenance items, (2) outstanding elements in facets that are nearly complete, (3) cross-reference confirmations ("earlier you said X — is that still the case?"). Never ask about something already answered; every follow-up must cite what prompted it.

**R4.3 — Session cross-referencing.** Maintain a running claims ledger (claim, facet element, provenance, turn reference). Follow-up generation reads the ledger, not the raw transcript, to guarantee no repeated questions.

**Acceptance.** Replaying the fault-management interview as three long free-form narrations produces ≤ 6 total follow-up questions, none of which asks for information already given.

---

## R5 — Process visualisation: BPMN as-is, to-be, and opportunity overlay (P0 — the major feature of this delta)

**Agreed scope.** From each completed spec, generate: (a) an as-is BPMN process diagram annotated with bottlenecks; (b) a proposed to-be diagram showing the process with bottlenecks addressed; (c) a technical-opportunity overlay classifying activities by automation potential. Rendered in-app and exportable.

### R5.1 — Typed process graph (canonical artefact — build and test this first)

The LLM never writes BPMN XML. A dedicated extraction pass converts a completed spec into a typed process graph (JSON, Zod-validated), which is the single source of truth for all three views. Schema (minimum):

```
ProcessGraph {
  processId, name, specRef, generatedAt
  lanes:      [{ id, name, sourceFacet }]                     // from facet 2
  events:     [{ id, type: start|end|boundary, name, laneId, sourceFacet }]   // facets 3, 10
  activities: [{ id, name, laneId, systems: [entityId], sourceFacet }]        // facet 5
  gateways:   [{ id, type: exclusive|parallel, name, condition, sourceFacet }] // facet 6
  flows:      [{ id, from, to, condition? }]
  annotations: [{ id, targetId, kind: bottleneck|risk|metric,
                 text, evidence: { facet, quote? }, metrics? }]               // facets 9, 11, 12
}
```

Every node and annotation carries `sourceFacet` — a diagram element with no facet lineage is invalid. Validation rules: exactly one start event; ≥ 1 end event; no orphan nodes; all flows reference existing nodes; every gateway has ≥ 2 outgoing flows.

### R5.2 — Deterministic BPMN 2.0 serialisation

A pure function transforms ProcessGraph → BPMN 2.0 XML (process semantics + BPMN DI for layout; use a layered auto-layout, e.g. elkjs, for the DI coordinates). Round-trip test: XML parses in bpmn-js and re-extracting elements matches the graph. The XML download is the ARIS import path — name it explicitly in the UI ("Export BPMN 2.0 (ARIS-compatible)").

### R5.3 — As-is view with bottleneck annotations

Render with bpmn-js (viewer mode) in the spec detail page. Bottleneck/risk/metric annotations render as overlay badges on their target elements; clicking a badge opens the evidence panel showing the facet citation (e.g. appointment booking activity → "25% structural backlog; 24-hour target met ~50% — facet 12"). Solid styling; provenance banner: **As-is — stated, from interview of [informant]**.

### R5.4 — To-be view as a change-set

The to-be diagram is not a second hand-built graph. It is the as-is graph plus a machine-generated **ChangeSet**:

```
ChangeSet { changes: [{ op: add|remove|modify|reorder, target, description,
                        resolvesAnnotationId, rationale }] }
```

Hard constraint: every change must reference the bottleneck annotation it resolves. A change with no `resolvesAnnotationId` is rejected at validation. The to-be renderer applies the change-set and styles changed elements distinctly (dashed borders + change badge). Provenance banner: **To-be — proposed, machine-generated, unverified** until verified.

**Verification gate (locked decision, unchanged).** To-be diagrams and their change-sets appear only in the admin analysis view until a human reviewer approves, edits, or rejects each change. Only verified change-sets can be included in handover reports. Store reviewer identity and timestamp per change. Human edits to change-sets are logged as eval signal.

### R5.5 — Technical-opportunity overlay

A classification pass over as-is activities, one label each:
- `automatable` — deterministic inputs/outputs, system API surface exists, no judgement or approval authority required
- `assistable` — agent-supported but human decision retained (e.g. next-best-action selection)
- `human-required` — approval authority, physical presence, or regulatory requirement (e.g. compensation > £15 approval; on-site technician work)

Each classification must cite its evidence from the systems/rules/data facets in a fixed structure `{ label, evidence: [facetRefs], rationale }`. No classification without cited evidence — if evidence is insufficient, label `unclassified` and say why. Overlay toggles on the as-is view (colour-coded lane-safe badges). Provenance: **proposed**; same verification gate as R5.4 before appearing in handover reports.

### R5.6 — UI integration

Spec detail page gains a **Process map** tab with three sub-views (As-is / To-be / Opportunities), a provenance banner, evidence side-panel, and exports: BPMN 2.0 XML, SVG, PNG. Minimalist treatment — diagram is the hero, chrome recedes; VMO2 design system tokens only.

### R5.7 — Eval fixtures (build before the feature)

Use `spec-fault-management-process-v1.md` as ground truth. The extraction eval asserts, at minimum:
- Lanes include: customer, IVR, contact centre agent, field technician (field ops and IT support may be lanes or referenced roles — record the choice in DECISIONS.md)
- One start event (customer contact with fault); end event chain includes work order closure and NPS capture
- An exclusive gateway for next-best-action with ≥ 6 outgoing options
- A compensation decision structure encoding the ~£15 agent limit and ~£150 manager limit
- Boundary/exception paths for: customer not home; transient fault; CPE-swap misdiagnosis; external outage misidentified (multi-truck)
- Bottleneck annotations on appointment booking (25% backlog; 50% target attainment) and on outage misidentification (wasted truck)
- Opportunity pass labels outage-check/diagnostics as `automatable` or `assistable` with cited evidence, and compensation-above-limit plus on-site work as `human-required`

Score extraction runs against this fixture in CI; a planted-fault variant (deliberately corrupted spec) must produce validation failures, not silent bad graphs. **Appendix A provides the visual acceptance reference and the expected change-set for this fixture.**

---

## R6 — Process-template pre-fetch (P2)

When early conversation identifies the process class, retrieve a matching template (seed the library from eTOM level-2/3 process elements relevant to VMO2) and use it to: pre-structure remaining checklist elements, seed pick-list options, and offer the interviewee a "does your process broadly follow this shape?" confirmation. Templates are scaffolding only — they never mark elements captured and template-derived content is never written into the spec without interview confirmation. Defer if R1–R5 consume the iteration.

---

## R7 — Voice / call-based capture (backlog — do not build)

North star: calendar invite, enterprise process agent joins the call, realtime voice interview. Blocked behind: DPIA (call recording), consent flow design, Teams app approval. Log in DECISIONS.md as deferred with these gates. Web-only remains the delivery decision. (Cross-reference for the product owner: this evidence also bears on Adibo decision D8a.)

---

## R8 — Suggested responses (answer chips) (P1)

**Agreed scope.** Above the chat input, optionally show up to three candidate answers for the current question as selectable chips. Sources, in priority order: (a) the engagement's uploaded artefacts (R3) — a candidate found in the informant's own material is the strongest suggestion; (b) the matched process template / industry-standard process knowledge (R6 library); (c) canonical entities from prior interviews in the engagement. Each chip displays a short answer plus a source tag ("from your uploaded doc: [name]" / "industry standard").

**R8.1 — Evidentiary guardrails (hard requirements).**
- Chips are *selected*, never pre-filled into the input field. Tapping a chip requires an explicit confirm ("Yes, this is how we do it") before it is recorded.
- "None of these — let me describe it" is always present and visually co-equal with the chips.
- An accepted chip is recorded with provenance `confirmed-suggestion` plus its source reference — never `stated`. A spontaneously typed answer that happens to match a chip remains `stated`.
- Chips never appear for the bottlenecks & issues facet or the exceptions facet — those must always be elicited spontaneously, as they are where tacit knowledge and template deviation concentrate.

**R8.2 — Deviation probing.** Whenever a `confirmed-suggestion` answer is recorded, enqueue a low-cost follow-up candidate for R4's selector: "you confirmed the standard [X] — does your team do anything differently?" Deviations from suggested/standard answers are high-value tacit knowledge; capture them as `stated` claims linked to the suggestion they diverge from.

**R8.3 — Suppression rules.** No chips when confidence is low (poor template match, no artefact evidence), when the question targets an open facet in free-narration mode, or when the interviewee has ignored chips three times in a row (back off for the remainder of the facet).

**Acceptance.** In a session with the fault-management artefact uploaded, the systems question shows chips sourced from the artefact with source tags; accepting one records `confirmed-suggestion` with the artefact reference; the generated spec visibly distinguishes it from `stated` content; no chips ever render on facets 10 or 12.

---

## R9 — Bounded interview and graceful finish (P0)

**Problem observed.** Questions can go on and on. Interviewees are impatient; a process user who cannot finish must be able to stop recording without the output silently degrading.

**R9.1 — Question budget.** Configurable per engagement: soft cap per facet (default 3 follow-ups) and global cap (default 25 questions). The counter is visible to the interviewee ("question 14 of ~25") so the interview has a felt horizon.

**R9.2 — Information-value ordering.** At every turn the system asks the single highest-value next question, ranked by: (1) `conflicting` provenance items, (2) outstanding elements in mandatory-core facets (identity & context, triggers, workflow, business rules), (3) outstanding elements in nearly-complete facets, (4) everything else. Budget exhaustion therefore truncates from the least important end. This ranking is shared with R4.2 — implement once.

**R9.3 — Graceful finish.** A "Finish recording" action is available at all times. On trigger: the system asks its single highest-value remaining question as an explicitly optional last call, then generates the spec regardless of coverage state. Outstanding elements are written to `open_items` in the front-matter with their facet references; the `coverage` block reflects actual counts. The completion screen shows the interviewee what was captured and what remains open, framed neutrally (not as failure).

**R9.4 — Quality through honesty, not padding.** A truncated interview must never render outstanding elements as answered, and generated prose must not paper over gaps — sections with outstanding elements state what is missing. `open_items` is the seed list for follow-up sessions and for R3 artefact ingestion to close asynchronously; the admin view surfaces engagements with material open items.

**R9.5 — Budget interaction with R8.** Chip-accepted answers cost less time, not fewer questions — the budget counts questions asked, so R8 stretches what a budget captures rather than gaming the counter.

**Acceptance.** Ending the fault-management interview after facet 6 produces a valid spec whose front-matter lists all facet 7–12 outstanding elements in `open_items` with accurate coverage counts; no section claims content that was not captured; R5 graph extraction on a truncated spec either succeeds with annotations flagged incomplete or fails validation loudly — never silently renders an authoritative-looking diagram from material gaps (record the chosen behaviour in DECISIONS.md).

---

## R10 — Interview interface UX and data-loss protection (P0)

**Agreed scope.** The capture surface must be unambiguous about recording state, make transcription visibly trustworthy, and make it effectively impossible to lose a transcript by accident. Data-loss protection is a hard requirement, not polish: a lost interview is destroyed evidence.

**R10.1 — Recording state clarity.**
- While capturing, show a single, unmistakable red button with the text label **Stop** (icon plus word — never icon-only), a pulsing recording indicator, and an elapsed-time counter.
- Exactly three states, visually distinct at a glance: **idle** (Start/Record), **recording** (red Stop, pulse, timer), **paused** (Resume + amber indicator). No state where the user could be unsure whether they are being captured.
- Stop ends capture of the current answer; it never discards anything. The stopped transcription remains on screen for review.

**R10.2 — Transcription intuitiveness.**
- Live transcription streams into view as the user speaks, in readable type near the input — the user watches their words land and learns to trust the capture.
- After Stop, the transcribed text is presented as an editable draft: the user can correct mis-transcriptions inline before submitting. Corrections are normal; they do not alter provenance (still `stated`).
- Clear affordance separating **Submit answer** from **Re-record**. Re-record requires confirmation and retains the prior take until the new one is submitted (see R10.3).

**R10.3 — Data-loss protection (hard requirements).**
- **Continuous autosave.** Every transcription draft persists to the server (SQLite) as it streams — at minimum every few seconds and on every state change. A crash, tab close, or connection drop loses seconds, not the session.
- **Session recovery.** Reopening the interview URL restores the exact prior state, including any unsubmitted draft, with a "you have an unsubmitted answer" banner.
- **No single-action destruction.** There is no delete button adjacent to Submit. Discarding a draft requires an explicit confirmation dialog that states what will be lost ("Discard 4 minutes of transcription?"). Destructive and primary actions are never visually similar or physically adjacent.
- **Undo window.** A discarded draft is soft-deleted and recoverable via Undo for the remainder of the session; hard deletion only occurs at engagement decommission per the existing data-destruction terms.
- **Navigation guard.** Leaving the page with an unsubmitted draft triggers a browser confirmation (beforeunload) and the draft is autosaved regardless of the user's choice.
- **Re-record safety.** Starting a re-record archives the prior take rather than overwriting it; the prior take is recoverable until the replacement is submitted.

**R10.4 — Minimalist treatment.** One primary action per state, VMO2 design system tokens, generous type for the live transcript, chrome recedes. The interviewee should never have to think about the tool — only about their process.

**Acceptance.**
- Killing the browser mid-answer and reopening the URL restores the draft with at most a few seconds of loss.
- No sequence of two taps can permanently destroy a transcription.
- A usability check with a first-time user: they can state, without prompting, whether recording is active, how to stop, and how to submit.
- Discard → Undo restores the draft byte-identical.

---

## Cross-cutting

- **Provenance is structural everywhere.** `stated` / `documented` / `corroborated` / `conflicting` / `confirmed-suggestion` for captured content; `proposed` for generated recommendations (to-be, opportunities). Handover reports include `stated`, `corroborated`, `confirmed-suggestion` (always displayed with its source), and human-verified `proposed` content.
- **Schema changes** (claims ledger, provenance classes, ProcessGraph, ChangeSet, verification records, artefact records, entity taxonomy) land as Drizzle migrations with seed data for the fixture engagement.
- **Every human verification edit is recorded** as eval signal (before/after, reviewer, timestamp).
- **STATUS.md** updated per requirement; **DECISIONS.md** append-only for all material choices, including the R5.7 lane-modelling decision.

## Definition of done for this delta

R1, R2, R10, R9, R5 complete with passing evals; R8, R3, R4 complete or explicitly descoped in DECISIONS.md with reason; fault-management fixture renders a verified as-is diagram, a reviewable to-be change-set, and an evidence-cited opportunity overlay; a truncated-interview run produces an honest spec with populated `open_items`; a killed-and-restored session recovers its draft; BPMN 2.0 export opens cleanly in an external BPMN tool.

---

## Appendix A — R5 visual acceptance reference (fault management fixture)

Reference files in `r5-reference/`:
- `fault-management-as-is.svg` — as-is flow with bottleneck annotations
- `fault-management-to-be.svg` — to-be flow with the proposed change-set applied

**What is normative in these renderings** (the bpmn-js output must reproduce these properties):
1. **Topology.** The node set, gateway placement, branch structure, and exception-relevant ordering shown — including the remote-fix branch merging into closure, and (to-be) the outage gate sitting *before* the next-best-action gateway and availability confirmation sitting *before* the technician visit.
2. **Annotation binding.** Each bottleneck annotation attaches to the specific element it evidences (diagnostics → outage misreads; booking → 25% backlog and 24 h/~50% target; technician visit → not-home and transient-fault wasted trucks), and clicking it must reveal the facet citation.
3. **Provenance styling is structural.** As-is elements render solid; every to-be change renders visibly distinct (dashed treatment in the reference) with a legend stating proposed/unverified. A user must be able to tell changed from unchanged without reading labels.
4. **Change annotations name their target bottleneck** on the diagram, mirroring `resolvesAnnotationId`.

**What is illustrative only:** exact colours, fonts, and layout geometry. The in-app rendering uses bpmn-js auto-layout and VMO2 design system tokens (Aeonik Pro; O2 Blue #0050FF primary), not this reference palette. Simplifications made for legibility (e.g. lanes shown as colour coding, next-best-action options collapsed to two branches) do not license simplifying the extracted ProcessGraph — the graph must carry the full fixture detail per R5.7; these renderings show the *presentation* standard, not the *extraction* standard.

**Expected ChangeSet for the fixture** (the R5.4 generator, run on the fixture spec, should produce changes materially equivalent to these — wording may differ, resolution links may not):

```json
{
  "baseGraph": "fault-management-as-is",
  "provenance": "proposed",
  "verified": false,
  "changes": [
    {
      "op": "add",
      "target": "activity:automated-outage-gate",
      "description": "Insert automated outage verification and fault re-test between diagnostics and the next-best-action decision; a confirmed external outage or a cleared (transient) fault cannot proceed to truck dispatch.",
      "resolvesAnnotationId": ["ann:outage-misidentification", "ann:transient-fault-wasted-truck"],
      "rationale": "Facet 12 / facet 10: outage misidentification and transient faults are principal causes of wasted truck; both are detectable before dispatch (facet 9: Einstein exists for this purpose)."
    },
    {
      "op": "modify",
      "target": "activity:raise-order-book-visit",
      "description": "Replace FIFO appointment queue with priority-based scheduling (severity / SLA risk).",
      "resolvesAnnotationId": ["ann:backlog-25pct", "ann:24h-target-50pct"],
      "rationale": "Facet 6: queue is FIFO; facet 12: 25% structural backlog and ~50% target attainment. Priority queuing improves which faults meet the 24 h target; backlog volume itself is a supply-demand mismatch relieved indirectly by the wasted-truck reductions above."
    },
    {
      "op": "add",
      "target": "activity:confirm-availability",
      "description": "Insert two-way customer availability confirmation with auto-rebook before technician dispatch; unconfirmed slots are re-offered instead of rolled.",
      "resolvesAnnotationId": ["ann:customer-not-home"],
      "rationale": "Facet 10: not-home visits force rebooking after a wasted roll; facet 4: a pre-appointment notification already exists but is one-way."
    }
  ]
}
```

Eval assertions on the generated change-set: every change carries ≥ 1 valid `resolvesAnnotationId`; the three bottleneck annotation groups above are each resolved by at least one change; no change resolves nothing; the honest-limits caveat pattern (backlog is structural) appears in the rationale for the scheduling change or in the report narrative.

