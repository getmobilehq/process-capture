/**
 * The facets machine spec (BUILD-REQUIREMENTS §7).
 *
 * Single source of truth, typed, consumed by the engine, the coverage rail, the
 * renderer, and the evals. Twelve facets, ordered 1–12. Do not reorder or renumber
 * — facetId is a stable key stored on every Statement and CoverageState row.
 */

export type FacetId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

/**
 * One expected element of a facet's checklist (delta v1.1 R1.1). Elements — not
 * facets — are the unit of coverage: the meter is derived from them, and the
 * interviewee can always read what is still outstanding in plain language.
 *
 * `id` is a stable key stored on every ElementState row. Never rename one; add a
 * new element and retire the old.
 */
export interface FacetElement {
  id: string;
  /** Plain language, shown to the interviewee on the rail. No modelling jargon. */
  label: string;
  /** What counts as substantively answered — the model's per-element rubric (R1.2). */
  capturedWhen: string;
}

/**
 * How a facet is elicited (delta v1.1 R2.1). Several facets are closed sets in
 * practice: asking open questions for them wastes the informant's patience and
 * produces inconsistent vocabulary across interviews.
 */
export type Elicitation = 'open' | 'picklist';

/** The kind of canonical entity a pick-list facet collects (R2.3). */
export type EntityKind = 'trigger' | 'role' | 'io' | 'system';

export interface Facet {
  id: FacetId;
  /** Human name shown on the rail and in the spec heading. */
  name: string;
  /** Condensed objective — what this facet is trying to establish. */
  objective: string;
  /** 2–4 opening / follow-up questions the agent can draw on. */
  probes: string[];
  /** Plain-language rubric the model is given for set_coverage proposals. */
  answeredWhen: string;
  /** Calibration example, in the voice of a worked answer, shown to the model. */
  example: string;
  /** The checklist this facet is scored against (R1.1). */
  elements: readonly FacetElement[];
  /** Open (probabilistic) or pick-list (deterministic) elicitation (R2.1). */
  elicitation: Elicitation;
  /** Present on pick-list facets only — what kind of entity they collect. */
  entityKind?: EntityKind;
}

export const FACETS: readonly Facet[] = [
  {
    id: 1,
    name: 'Process identity & context',
    objective: 'Name, purpose, and the start and end boundaries of the process.',
    probes: [
      'In your own words, what is this process and what is it there to achieve?',
      'What happens right at the start — what kicks it off?',
      'And when do you consider it finished — what is the last thing that happens?',
    ],
    answeredWhen: 'Purpose is stated, plus both the start and end boundaries.',
    example:
      'Handling a customer complaint about a billing error, from the moment it lands in the queue to the point the customer is told the outcome and the case is closed.',
    elements: [
      {
        id: 'identity.purpose',
        label: 'What the process is for',
        capturedWhen: 'The informant has said what the process achieves and why it exists.',
      },
      {
        id: 'identity.start',
        label: 'Where it starts',
        capturedWhen: 'The first thing that happens, or the condition that opens the process.',
      },
      {
        id: 'identity.end',
        label: 'Where it finishes',
        capturedWhen: 'The last thing that happens, or the condition that closes the process.',
      },
    ],
    elicitation: 'open',
  },
  {
    id: 2,
    name: 'Stakeholders & resources',
    objective: 'Roles involved, who does what, and the hand-off partners.',
    probes: [
      'Who is involved in getting this done, thinking in terms of roles rather than names?',
      'Who do you hand work to, or receive work from?',
      'Is anyone else consulted or kept informed along the way?',
    ],
    answeredWhen: 'The roles on the main flow are enumerated.',
    example:
      'A complaints advisor owns the case; a billing analyst confirms the charge; a team leader approves any goodwill credit; the customer is kept informed throughout.',
    elements: [
      {
        id: 'stakeholders.roles',
        label: 'Who is involved',
        capturedWhen: 'The roles on the main flow are named as roles, not individuals.',
      },
      {
        id: 'stakeholders.responsibilities',
        label: 'Who does what',
        capturedWhen: 'Each named role is tied to what it is responsible for.',
      },
      {
        id: 'stakeholders.handoffs',
        label: 'Who work passes to and from',
        capturedWhen:
          'Hand-off partners upstream or downstream are identified, or it is established there are none.',
      },
    ],
    elicitation: 'picklist',
    entityKind: 'role',
  },
  {
    id: 3,
    name: 'Triggers & events',
    objective: 'What starts the process, and any timing or frequency patterns.',
    probes: [
      'What has to happen for this process to begin?',
      'How often does it run — is there a pattern to when it comes up?',
      'Is it always the same trigger, or are there a few different ways it can start?',
    ],
    answeredWhen: 'At least the primary trigger is stated, with cadence if there is one.',
    example:
      'Triggered when a customer raises a billing complaint by phone or web form; roughly forty a day per advisor, heaviest just after monthly bills go out.',
    elements: [
      {
        id: 'triggers.initiating',
        label: 'What sets it off',
        capturedWhen: 'At least one initiating trigger is stated.',
      },
      {
        id: 'triggers.channels',
        label: 'How it arrives',
        capturedWhen: 'The channel or route the trigger comes in by is stated.',
      },
      {
        id: 'triggers.timing',
        label: 'How often it happens',
        capturedWhen:
          'A frequency, cadence, or timing pattern is given, even roughly — or established that there is none.',
      },
      {
        id: 'triggers.secondary',
        label: 'Other ways it can start',
        capturedWhen:
          'Secondary or escalation triggers are given, or it is established the primary trigger is the only one.',
      },
    ],
    elicitation: 'picklist',
    entityKind: 'trigger',
  },
  {
    id: 4,
    name: 'Inputs & outputs',
    objective: 'What comes in to the process, and what it produces.',
    probes: [
      'What information or materials do you need in hand before you can start?',
      'What does the process produce — what exists at the end that did not before?',
      'Where do those inputs come from, and where do the outputs go?',
    ],
    answeredWhen: 'Primary inputs and primary outputs are both stated.',
    example:
      'In: the complaint record, the account and its billing history. Out: a resolution decision, any credit applied, and a closure note on the account.',
    elements: [
      {
        id: 'io.inputs',
        label: 'What you need to start',
        capturedWhen: 'The primary inputs — information or materials — are stated.',
      },
      {
        id: 'io.sources',
        label: 'Where those come from',
        capturedWhen: 'The origin of the primary inputs is stated.',
      },
      {
        id: 'io.outputs',
        label: 'What it produces',
        capturedWhen: 'The primary outputs — what exists at the end that did not before — are stated.',
      },
      {
        id: 'io.destinations',
        label: 'Where the outputs go',
        capturedWhen: 'The destination or consumer of the primary outputs is stated.',
      },
    ],
    elicitation: 'picklist',
    entityKind: 'io',
  },
  {
    id: 5,
    name: 'Workflow & activities',
    objective: 'The ordered steps, actors, systems, decisions, and hand-offs.',
    probes: [
      'Walk me through the last real case you handled, step by step.',
      'At each step, who does it and in which system?',
      'Where are the decision points — where does the path fork depending on what you find?',
    ],
    answeredWhen:
      'An ordered account of the main path, including at least one hand-off or decision where any exist.',
    example:
      'Advisor reads the complaint in the CRM; pulls the billing history; if the charge is wrong they raise a credit; if it is over the limit they route to a team leader for approval; then they call the customer and close the case.',
    elements: [
      {
        id: 'workflow.steps',
        label: 'The steps, in order',
        capturedWhen: 'An ordered account of the main path from start to finish.',
      },
      {
        id: 'workflow.actors',
        label: 'Who does each step, and where',
        capturedWhen: 'Steps are attributed to a role and, where relevant, to a system.',
      },
      {
        id: 'workflow.decisions',
        label: 'Where the path forks',
        capturedWhen:
          'At least one decision point is described, or it is established the path never forks.',
      },
      {
        id: 'workflow.handoffs',
        label: 'Where work changes hands',
        capturedWhen:
          'At least one hand-off is described, or it is established the work stays with one role.',
      },
    ],
    elicitation: 'open',
  },
  {
    id: 6,
    name: 'Business rules & decisions',
    objective: 'Rules, approval criteria and thresholds, and decision logic.',
    probes: [
      'When you decide whether to apply a credit, what governs that — is there a limit you can do yourself?',
      'What are the actual figures — at what point does it need someone else to sign off?',
      'Are there different tiers of approval as the amounts get bigger?',
    ],
    answeredWhen:
      'Rules are stated to their thresholds and levels where approvals exist — probe to £ bands and governance tiers.',
    example:
      'An advisor can credit up to £25 on their own; £25–£100 needs a team leader; £100–£500 needs a duty manager; anything above £500 goes to the billing governance board.',
    elements: [
      {
        id: 'rules.governing',
        label: 'The rules you work to',
        capturedWhen: 'The rules or criteria governing the main decisions are stated.',
      },
      {
        id: 'rules.thresholds',
        label: 'The limits and figures',
        capturedWhen:
          'EVERY band in the escalation ladder is given as a number, not just the first. If they say "I can do £25 myself, above that it goes to a manager", the manager\'s own limit and whatever sits above it are still outstanding — keep probing until they reach the top of the ladder or say they do not know. "It gets approved" and a single figure are both insufficient.',
      },
      {
        id: 'rules.approvals',
        label: 'Who signs off, and at what level',
        capturedWhen:
          'Every approval tier is tied to the role that holds it, up to the top of the ladder — or established that no approval is required.',
      },
    ],
    elicitation: 'open',
  },
  {
    id: 7,
    name: 'Data & information',
    objective: 'Records created or used, and where they live.',
    probes: [
      'What records do you create or update as you go?',
      'Where does each of those live — which system holds it?',
      'Is anything kept outside the main systems, like a spreadsheet or a shared inbox?',
    ],
    answeredWhen: 'The key records and the systems that hold them are stated.',
    example:
      'The case record lives in the CRM; the credit is posted in the billing platform; a monthly reconciliation is kept in a shared spreadsheet.',
    elements: [
      {
        id: 'data.records',
        label: 'What you create or update',
        capturedWhen: 'The key records touched by the process are named.',
      },
      {
        id: 'data.location',
        label: 'Where each one lives',
        capturedWhen: 'Each key record is tied to the system or place that holds it.',
      },
      {
        id: 'data.shadow',
        label: 'Anything kept on the side',
        capturedWhen:
          'Spreadsheets, shared inboxes or local records outside the main systems are identified, or established that there are none.',
      },
    ],
    elicitation: 'open',
  },
  {
    id: 8,
    name: 'Technology & systems',
    objective: 'The systems and tools the process touches.',
    probes: [
      'Which systems or tools do you use to get this done?',
      'Do any of them talk to each other, or do you rekey between them?',
      'Is there anything manual — email, phone, paper — in the mix?',
    ],
    answeredWhen: 'The systems on the main path are named.',
    example:
      'The CRM for the case, the billing platform for charges and credits, Outlook for internal chasers, and the phone system for the outbound call.',
    elements: [
      {
        id: 'systems.named',
        label: 'The systems you use',
        capturedWhen: 'The systems and tools on the main path are named.',
      },
      {
        id: 'systems.integration',
        label: 'Whether they talk to each other',
        capturedWhen:
          'It is established which systems are integrated and where the informant rekeys between them.',
      },
      {
        id: 'systems.manual',
        label: 'The manual bits',
        capturedWhen:
          'Email, phone, paper or other manual channels in the mix are identified, or established that there are none.',
      },
    ],
    elicitation: 'picklist',
    entityKind: 'system',
  },
  {
    id: 9,
    name: 'Risk, controls & compliance',
    objective: 'Controls, regulatory obligations, and checks.',
    probes: [
      'Are there any checks or sign-offs in place to stop things going wrong?',
      'Is any of this governed by regulation or a formal policy?',
      'What would count as getting it wrong, and how is that caught?',
    ],
    answeredWhen: 'Controls are stated — or an honest unknown is recorded.',
    example:
      'Credits over £100 are sampled by a QA team monthly; complaints have to be resolved within the regulator’s eight-week window; the advisor is not sure who audits the timeliness.',
    elements: [
      {
        id: 'risk.controls',
        label: 'The checks in place',
        capturedWhen:
          'Checks, sign-offs or quality controls are stated, or established that there are none.',
      },
      {
        id: 'risk.obligations',
        label: 'Rules imposed from outside',
        capturedWhen:
          'Regulatory or formal policy obligations are identified, or established that none apply.',
      },
      {
        id: 'risk.failure',
        label: 'What going wrong looks like',
        capturedWhen: 'What counts as an error, and how it would be caught, is described.',
      },
    ],
    elicitation: 'open',
  },
  {
    id: 10,
    name: 'Variants & exceptions',
    objective: 'Alternative paths, and what happens when it goes wrong.',
    probes: [
      'Is the process ever different — are there cases that do not follow the usual path?',
      'What happens when something goes wrong partway through?',
      'What is the trickiest kind of case you get, and how does it differ?',
    ],
    answeredWhen: 'At least the main exception path is stated.',
    example:
      'If the customer has already been credited once for the same issue, it skips straight to a team leader; if the billing system is down, the case is parked and picked up the next day.',
    elements: [
      {
        id: 'exceptions.variants',
        label: 'Cases that go a different way',
        capturedWhen:
          'At least one alternative path is described, or established that every case follows the same path.',
      },
      {
        id: 'exceptions.failure',
        label: 'When it goes wrong partway',
        capturedWhen: 'What happens on failure or interruption mid-process is described.',
      },
      {
        id: 'exceptions.hardest',
        label: 'The trickiest kind of case',
        capturedWhen: 'The hardest case type is described, and how it differs from the usual path.',
      },
    ],
    elicitation: 'open',
  },
  {
    id: 11,
    name: 'Performance',
    objective: 'Volumes, durations, and targets.',
    probes: [
      'Roughly how many of these do you handle in a day or a week?',
      'From start to finish, how long does a typical one take?',
      'Is there a target or SLA you are working to?',
    ],
    answeredWhen: 'Volume and end-to-end duration are stated, even approximately.',
    example:
      'About forty a day; a straightforward one takes fifteen minutes, a complex one can run over two days waiting on approvals; the SLA is five working days.',
    elements: [
      {
        id: 'performance.volume',
        label: 'How many you handle',
        capturedWhen: 'A volume over some period is given, even approximately.',
      },
      {
        id: 'performance.duration',
        label: 'How long one takes',
        capturedWhen: 'An end-to-end duration is given, even as a range.',
      },
      {
        id: 'performance.target',
        label: 'The target you work to',
        capturedWhen: 'A target or SLA is stated, or established that there is none.',
      },
    ],
    elicitation: 'open',
  },
  {
    id: 12,
    name: 'Bottlenecks & issues',
    objective:
      'The longest task, queues, workarounds, and how standardised the work is.',
    probes: [
      'Which part of this takes the longest?',
      'Where does work pile up or wait on someone else?',
      'Have you got any workarounds — and does everyone do it the same way, or does it vary by person?',
    ],
    answeredWhen:
      'At least one concrete bottleneck is probed (longest task, queue point) and a standardisation read is taken.',
    example:
      'Waiting on team-leader approval is the big delay — cases can sit for a day in that queue. People keep their own spreadsheets to track what is pending, and everyone does it slightly differently.',
    elements: [
      {
        id: 'bottlenecks.longest',
        label: 'The part that takes longest',
        capturedWhen: 'A specific longest task or slowest stage is identified.',
      },
      {
        id: 'bottlenecks.queues',
        label: 'Where work waits',
        capturedWhen:
          'A queue or waiting point is identified, or established that work never waits.',
      },
      {
        id: 'bottlenecks.workarounds',
        label: 'Workarounds people use',
        capturedWhen: 'Workarounds are described, or established that there are none.',
      },
      {
        id: 'bottlenecks.standardisation',
        label: 'Whether everyone does it the same way',
        capturedWhen: 'A read is taken on how consistently the work is done across people.',
      },
    ],
    elicitation: 'open',
  },
] as const;

export const FACET_IDS: readonly FacetId[] = FACETS.map((f) => f.id);

export function getFacet(id: number): Facet {
  const f = FACETS.find((facet) => facet.id === id);
  if (!f) throw new Error(`Unknown facetId: ${id}`);
  return f;
}

export function isFacetId(id: number): id is FacetId {
  return FACET_IDS.includes(id as FacetId);
}

/** Every checklist element across all facets, in facet order (R1.1). */
export const ALL_ELEMENTS: readonly (FacetElement & { facetId: FacetId })[] = FACETS.flatMap((f) =>
  f.elements.map((e) => ({ ...e, facetId: f.id })),
);

const ELEMENTS_BY_ID = new Map(ALL_ELEMENTS.map((e) => [e.id, e]));

/** Element ids are globally unique — a duplicate would silently merge two rows. */
if (ELEMENTS_BY_ID.size !== ALL_ELEMENTS.length) {
  throw new Error('Duplicate facet element id in the facets spec');
}

export function getElement(elementId: string): (FacetElement & { facetId: FacetId }) | undefined {
  return ELEMENTS_BY_ID.get(elementId);
}

/** True iff the element exists *and* belongs to the facet claimed (P1 — server disposes). */
export function elementBelongsToFacet(elementId: string, facetId: number): boolean {
  return ELEMENTS_BY_ID.get(elementId)?.facetId === facetId;
}

export function elementsFor(facetId: number): readonly FacetElement[] {
  return getFacet(facetId).elements;
}

// ── Elicitation mode (delta v1.1 R2) ────────────────────────────────────────

/** Facets elicited as a tick-list rather than an open question (R2.1). */
export const PICKLIST_FACETS: readonly Facet[] = FACETS.filter(
  (f) => f.elicitation === 'picklist',
);

export function isPicklistFacet(facetId: number): boolean {
  return getFacet(facetId).elicitation === 'picklist';
}

export function entityKindFor(facetId: number): EntityKind | undefined {
  return getFacet(facetId).entityKind;
}

/** The facet that collects a given entity kind — the inverse of entityKindFor. */
export function facetForEntityKind(kind: EntityKind): FacetId | undefined {
  return FACETS.find((f) => f.entityKind === kind)?.id;
}

/**
 * Canonical key for an entity name (R2.3). Case, punctuation and spacing vary
 * wildly between informants ("Remedy/Helix", "remedy helix", "Remedy / Helix");
 * matching on this key is what lets cross-interview analysis line entities up.
 */
export function canonicalKey(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
