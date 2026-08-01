/**
 * Org-level entity taxonomy (delta v1.1 R2.2).
 *
 * The highest-priority source for a pick-list facet's options. Seeded per project
 * so an admin can curate it per engagement without touching code; the systems list
 * is pre-seeded from the VMO2 estate named in the fault-management fixture.
 *
 * These are `confirmed` entities — they are the house vocabulary. Anything an
 * informant names that is not here arrives as `pending`, awaiting admin
 * confirmation before it joins the taxonomy (R2.3).
 */
import type { EntityKind } from './facets';

export interface TaxonomySeed {
  kind: EntityKind;
  names: readonly string[];
}

export const TAXONOMY_SEED: readonly TaxonomySeed[] = [
  {
    kind: 'system',
    names: [
      'OmniEngage',
      'iComms',
      'Xenia',
      'Einstein',
      'CSRD/Netcracker 360',
      'IK',
      'Remedy/Helix',
      'Dialler/IVR',
    ],
  },
  {
    kind: 'role',
    names: [
      'Contact centre agent',
      'Team leader',
      'Duty manager',
      'Field technician',
      'Field operations',
      'IT support',
      'Billing analyst',
      'Customer',
    ],
  },
  {
    kind: 'trigger',
    names: [
      'Customer call',
      'Web form',
      'Chat',
      'Automated alert',
      'Scheduled run',
      'Escalation from another team',
    ],
  },
  {
    kind: 'io',
    names: [
      'Customer account record',
      'Case record',
      'Billing history',
      'Work order',
      'Diagnostic result',
      'Closure note',
    ],
  },
];
