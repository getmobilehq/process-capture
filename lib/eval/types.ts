/** Persona fixture for the eval harness (BUILD-REQUIREMENTS §9). */
export interface GroundTruthItem {
  facet: number;
  /** Distinctive terms; the fact is "present" if the facet's statements contain the keyword. */
  keyword: string;
}

export interface Persona {
  id: string;
  style: 'cooperative' | 'terse' | 'rambling';
  role: string;
  processName: string;
  /** The facet the informant genuinely cannot answer (A2). */
  knownUnknownFacet: number;
  /** Turn-count ceiling for this persona (A7). */
  turnLimit: number;
  /** All facts the informant may draw on, grouped by facet, for the simulated informant prompt. */
  facts: Record<string, string[]>;
  /** Numeric thresholds expected in facet-6 statements (A3). */
  facet6Thresholds: string[];
  /** Keywords, at least one expected in facet-12 statements (A4). */
  facet12Bottleneck: string[];
  /** Ground-truth spot-check items for facet fidelity (A9). */
  groundTruth: GroundTruthItem[];
}
