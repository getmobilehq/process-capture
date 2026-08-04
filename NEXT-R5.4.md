# R5.4 — to-be change-set: handover brief

Written at the end of the session that completed R5.1–R5.3 and R5.6 (partial), so
the next session can start without re-deriving context.

## What already exists (do not rebuild)

- `lib/graph/schema.ts` — `changeSetSchema` and `changeSchema` are written and
  typed. `resolvesAnnotationId` is `.min(1)`, so a change resolving nothing is
  rejected by the shape itself.
- `lib/graph/validate.ts` — `validateChangeSet(input, graph)` already enforces that
  every `resolvesAnnotationId` names an annotation that exists on the base graph.
  Tested in `tests/unit/process-graph.test.ts` ("change sets (R5.4)").
- `lib/graph/extract.ts` — the pattern to copy. Forced tool call, server-stamped
  provenance, one validation retry that explicitly refuses to invent structure.
- `components/graph/ProcessMap.tsx` — takes `{ xml, graph, informant }`. The to-be
  view should reuse it rather than fork it.
- `app/brand-ui.css` — `.pc-map-banner.tobe` is already written (dashed, muted) and
  currently unused. It is the provenance banner R5.4 asks for.

## What R5.4 needs

### 1. Generator — `lib/graph/changeset.ts`

Mirror `extract.ts`:

- Input: the base `ProcessGraph` (it carries its own annotations).
- Forced tool `emit_change_set`; system prompt states the hard constraint —
  **every change must reference the bottleneck annotation it resolves**, and a
  change that resolves nothing is a defect, not a suggestion.
- Server stamps `baseGraph`, `provenance: 'proposed'`, `verified: false`. The model
  never sets `verified` — approval is a human act (already the schema default).
- Validate with `validateChangeSet(candidate, graph)`; one retry with named errors;
  then throw a `ChangeSetGenerationError` carrying them.
- The retry must tell the model not to invent a bottleneck to justify a change it
  wants to make. Same failure mode as DL.32, opposite direction.

Appendix A of the delta gives the expected change-set for the fault-management
fixture — three changes (automated outage gate, priority scheduling, availability
confirmation). Use it as the eval assertion when the fixture lands.

### 2. Applying the change-set — pure function

`applyChangeSet(graph, changeSet): ProcessGraph`. Ops are `add | remove | modify |
reorder`. Keep it pure and deterministic; the to-be graph is derived, never
authored, exactly as the as-is XML is derived from the graph.

Mark changed node ids so the renderer can style them — suggest returning
`{ graph, changedIds: Set<string> }` rather than mutating nodes with a flag, so the
`ProcessGraph` type stays clean and `validateGraph` still applies unchanged.

### 3. View

- Reuse `ProcessMap` with the to-be graph and `.pc-map-banner.tobe`.
- Changed elements render visibly distinct — dashed borders plus a change badge —
  so a reader can tell changed from unchanged **without reading labels** (Appendix
  A, normative point 3). bpmn-js: `canvas.addMarker(id, 'pc-changed')` plus a CSS
  rule on `.djs-element.pc-changed .djs-visual > :first-child`.
- Each change badge names the bottleneck it resolves (Appendix A, point 4).

### 4. Verification gate — the locked decision

**This is the part not to skip.** Per R5.4:

- To-be views and change-sets appear **only in the admin analysis view** until a
  human approves, edits or rejects each change.
- Only verified change-sets may go into handover reports.
- Store reviewer identity and timestamp **per change**, not per set.
- Human edits to change-sets are logged as eval signal.

That needs a table — suggest `change_sets` (id, sessionId, specVersion, json,
createdAt) and `change_reviews` (id, changeSetId, changeIndex, verdict
approved|edited|rejected, editedJson, reviewer, reviewedAt). The console is
password-gated with a single admin, so "reviewer identity" is thin today — record
what there is and note the limitation rather than inventing users.

## Watch out for

- **Graph persistence is still missing (DL.38).** The map re-extracts per view. A
  change-set keyed to a graph that is regenerated each time will drift. Landing
  persistence first is probably cheaper than working around it.
- **The fault-management fixture is still absent.** R5.4's eval assertions in
  Appendix A are written against it. Without it, generator quality is unproven —
  same caveat as R5.7.
- **No runtime verification of the map yet.** No diagram has been drawn
  end-to-end; that needs a completed spec plus a live model call. Worth doing
  before layering the to-be view on top of an unproven renderer.
