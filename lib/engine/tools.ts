/**
 * Tools exposed to the model (BUILD-REQUIREMENTS FR-3.2). The model *proposes*
 * these; the server validates and applies them (P1). Definitions are in Anthropic
 * tool format; Zod schemas validate the model's arguments before anything touches
 * state. Invalid calls are rejected with an error result and the model is
 * reprompted once (handled by the engine).
 */
import { z } from 'zod';

export const STATEMENT_KINDS = ['fact', 'step', 'rule', 'metric', 'issue', 'quote'] as const;
export const COVERAGE_TARGET_STATES = [
  'partial',
  'answered',
  'unknown_to_informant',
  'not_applicable',
] as const;
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

export const raiseFindingSchema = z.object({
  facetId,
  type: z.enum(IN_SESSION_FINDING_TYPES),
  title: z.string().min(1),
  detail: z.string().optional().default(''),
});

export const endInterviewSchema = z.object({});

export type RecordStatementInput = z.infer<typeof recordStatementSchema>;
export type SetCoverageInput = z.infer<typeof setCoverageSchema>;
export type RaiseFindingInput = z.infer<typeof raiseFindingSchema>;

export const TOOL_NAMES = [
  'record_statement',
  'set_coverage',
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
      'Propose a coverage transition for a facet. The server enforces legal transitions. Use unknown_to_informant when the informant genuinely does not know; never guess.',
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
