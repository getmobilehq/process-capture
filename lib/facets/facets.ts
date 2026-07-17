/**
 * The facets machine spec (BUILD-REQUIREMENTS §7).
 *
 * Single source of truth, typed, consumed by the engine, the coverage rail, the
 * renderer, and the evals. Twelve facets, ordered 1–12. Do not reorder or renumber
 * — facetId is a stable key stored on every Statement and CoverageState row.
 */

export type FacetId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

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
