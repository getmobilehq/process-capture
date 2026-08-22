/**
 * The autonomy scale itself — levels, labels and colours (R5.9).
 *
 * Split from `autonomy.ts` deliberately. That module reaches the model and so
 * imports the Anthropic SDK and the server config; a client component importing
 * the level colours from it would drag all of that into the browser bundle. The
 * scale is presentation, shared by both sides, and has no dependencies at all.
 */
export const AUTONOMY_LEVELS = ['L0', 'L1', 'L2', 'L3', 'unassessed'] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

export interface LevelMeta {
  level: AutonomyLevel;
  title: string;
  gloss: string;
  /** Brand-adjacent, and readable without relying on hue alone. */
  fill: string;
  ink: string;
  border: string;
}

export const LEVEL_META: Record<AutonomyLevel, LevelMeta> = {
  L3: { level: 'L3', title: 'L3', gloss: 'Agent runs it autonomously', fill: '#e6f7d9', ink: '#2f6b1f', border: '#8cc46a' },
  L2: { level: 'L2', title: 'L2', gloss: 'Agent executes, human verifies', fill: '#d6f5f0', ink: '#0f6b60', border: '#63c4b6' },
  L1: { level: 'L1', title: 'L1', gloss: 'Agent assists, human executes', fill: '#fdf0cd', ink: '#8a5c00', border: '#e0bc4d' },
  L0: { level: 'L0', title: 'L0', gloss: 'Human only — by nature or by design', fill: '#f1eef3', ink: '#4a4550', border: '#c3bcc8' },
  unassessed: { level: 'unassessed', title: '?', gloss: 'Not enough evidence to place this step', fill: '#ffffff', ink: '#8a8a8a', border: '#d9d9d9' },
};

export interface ActivityAutonomy {
  activityId: string;
  level: AutonomyLevel;
  /** Facets supporting the level. Required unless `unassessed`. */
  evidence: number[];
  rationale: string;
  /** What would have to change to reach the next level up. Empty at L3. */
  toAdvance: string;
}

export interface AutonomySet {
  graphRef: string;
  levels: ActivityAutonomy[];
  provenance: 'proposed';
  verified: false;
}

export interface LaneBreakdown {
  laneId: string;
  laneName: string;
  counts: Record<AutonomyLevel, number>;
  total: number;
}

export interface AutonomySummary {
  counts: Record<AutonomyLevel, number>;
  total: number;
  /** Steps at L2 or L3 — where a system could do the work itself. */
  systemCanDo: number;
  unassessedShare: number;
  byLane: LaneBreakdown[];
}
