/**
 * Tools exposed to the model (BUILD-REQUIREMENTS FR-3.2). The model *proposes*
 * these; the server validates and applies them (P1). Definitions are in Anthropic
 * tool format; Zod schemas validate the model's arguments before anything touches
 * state. Invalid calls are rejected with an error result and the model is
 * reprompted once (handled by the engine).
 */
import { z } from 'zod';

export const STATEMENT_KINDS = ['fact', 'step', 'rule', 'metric', 'issue', 'quote'] as const;
// Delta v1.1 R1.1: `answered` and `partial` are *derived* from the checklist and
// can no longer be proposed. What remains are the two honest human judgements the
// checklist cannot reach on its own (P3) — the informant does not know, or the
// facet does not apply to them at all.
export const COVERAGE_TARGET_STATES = ['unknown_to_informant', 'not_applicable'] as const;
// Only these finding types may be raised mid-interview (FR-3.2). candidate_conflict
// is a console-side action across informants (FR-1.6).
export const IN_SESSION_FINDING_TYPES = ['unknown_retarget', 'informant_flag'] as const;

const facetId = z.number().int().min(1).max(12);

export const recordStatementSchema = z.object({
  facetId,
  kind: z.enum(STATEMENT_KINDS),
  content: z.string().min(1),
  verbatim: z.boolean().optional().default(false),
});

export const setCoverageSchema = z.object({
  facetId,
  state: z.enum(COVERAGE_TARGET_STATES),
  rationale: z.string().optional().default(''),
});

// Delta v1.1 R1: elements are closed one at a time, with a one-line summary of
// what was actually captured. The facet meter is derived from these — the model
// never sets it directly.
export const ELEMENT_TARGET_STATES = ['captured', 'not_applicable'] as const;

export const setElementSchema = z.object({
  facetId,
  elementId: z.string().min(1),
  state: z.enum(ELEMENT_TARGET_STATES),
  // Required for captured — the rail shows this back to the interviewee, so an
  // empty summary would leave them unable to check what the system heard.
  summary: z.string().optional().default(''),
  reason: z.string().optional().default(''),
});

// Delta v1.1 R2.3: the model names an entity it heard; the server canonicalises
// and de-duplicates it. Free text still lands on a canonical id, so cross-interview
// analysis lines entities up instead of comparing prose.
export const ENTITY_KINDS = ['trigger', 'role', 'io', 'system'] as const;

export const recordEntitySchema = z.object({
  facetId,
  kind: z.enum(ENTITY_KINDS),
  name: z.string().min(1).max(120),
});

export const raiseFindingSchema = z.object({
  facetId,
  type: z.enum(IN_SESSION_FINDING_TYPES),
  title: z.string().min(1),
  detail: z.string().optional().default(''),
});

export const endInterviewSchema = z.object({});

export type RecordStatementInput = z.infer<typeof recordStatementSchema>;
export type SetCoverageInput = z.infer<typeof setCoverageSchema>;
export type SetElementInput = z.infer<typeof setElementSchema>;
export type RecordEntityInput = z.infer<typeof recordEntitySchema>;
export type RaiseFindingInput = z.infer<typeof raiseFindingSchema>;

export const TOOL_NAMES = [
  'record_statement',
  'set_coverage',
  'set_element',
  'record_entity',
  'raise_finding',
  'end_interview',
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

/** Anthropic tool definitions passed on every model call. */
export const TOOL_DEFINITIONS = [
  {
    name: 'record_statement',
    description:
      'Record a substantive fact the informant stated, filed to the correct facet, in their own words. Use verbatim=true sparingly for phrases worth preserving exactly.',
    input_schema: {
      type: 'object',
      properties: {
        facetId: { type: 'integer', minimum: 1, maximum: 12, description: 'Facet 1–12 this statement belongs to.' },
        kind: { type: 'string', enum: [...STATEMENT_KINDS], description: 'The kind of statement.' },
        content: { type: 'string', description: 'The statement, as the informant stated it.' },
        verbatim: { type: 'boolean', description: 'True to preserve the phrasing exactly.' },
      },
      required: ['facetId', 'kind', 'content'],
    },
  },
  {
    name: 'set_coverage',
    description:
      'Close a whole facet on an honest judgement the checklist cannot reach: unknown_to_informant when the informant genuinely does not know or it is not theirs to answer, not_applicable when the facet does not apply to their process at all. Never guess. You cannot mark a facet answered — that is derived from its checklist, so close elements with set_element instead.',
    input_schema: {
      type: 'object',
      properties: {
        facetId: { type: 'integer', minimum: 1, maximum: 12 },
        state: { type: 'string', enum: [...COVERAGE_TARGET_STATES] },
        rationale: { type: 'string', description: 'Why this transition — logged, not stored.' },
      },
      required: ['facetId', 'state'],
    },
  },
  {
    name: 'set_element',
    description:
      "Close one checklist element of a facet. Use captured when the informant has substantively answered it in any words — judge the content, never the vocabulary. Use not_applicable only when the informant has said it does not apply, with their reason. The server derives the facet meter from these; you cannot set it directly.",
    input_schema: {
      type: 'object',
      properties: {
        facetId: { type: 'integer', minimum: 1, maximum: 12 },
        elementId: {
          type: 'string',
          description: 'The element id exactly as given in the facet blueprint, e.g. triggers.initiating.',
        },
        state: { type: 'string', enum: [...ELEMENT_TARGET_STATES] },
        summary: {
          type: 'string',
          description:
            'One line, in the informant’s own terms, of what was captured. Shown back to them on screen — make it recognisable, not a restatement of the element name.',
        },
        reason: {
          type: 'string',
          description: 'For not_applicable only: the informant’s reason it does not apply.',
        },
      },
      required: ['facetId', 'elementId', 'state'],
    },
  },
  {
    name: 'record_entity',
    description:
      'Record a system, role, trigger, or input/output the informant named, so it joins the engagement vocabulary. The server canonicalises the name and de-duplicates it against what is already known — record what they said, in their words; do not translate it into house terminology yourself.',
    input_schema: {
      type: 'object',
      properties: {
        facetId: { type: 'integer', minimum: 1, maximum: 12 },
        kind: { type: 'string', enum: [...ENTITY_KINDS] },
        name: { type: 'string', description: 'The entity as the informant named it.' },
      },
      required: ['facetId', 'kind', 'name'],
    },
  },
  {
    name: 'raise_finding',
    description:
      'Raise a finding for a human. unknown_retarget: a facet the informant cannot answer and someone else should. informant_flag: something the informant flags as worth a second look.',
    input_schema: {
      type: 'object',
      properties: {
        facetId: { type: 'integer', minimum: 1, maximum: 12 },
        type: { type: 'string', enum: [...IN_SESSION_FINDING_TYPES] },
        title: { type: 'string' },
        detail: { type: 'string' },
      },
      required: ['facetId', 'type', 'title'],
    },
  },
  {
    name: 'end_interview',
    description:
      'End the interview. Permitted only when no facet is still pending or partial. On rejection you will be told which facets remain.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
] as const;
