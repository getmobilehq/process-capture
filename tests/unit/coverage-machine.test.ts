import { describe, it, expect } from 'vitest';
import {
  canTransition,
  assertTransition,
  isTerminal,
  isResolved,
  allResolved,
  IllegalCoverageTransitionError,
  type CoverageStateValue,
} from '@/lib/engine/coverage';

describe('coverage state machine (FR-3.2, P3)', () => {
  it('permits every legal transition from pending', async () => {
    for (const to of [
      'partial',
      'answered',
      'unknown_to_informant',
      'not_applicable',
    ] as CoverageStateValue[]) {
      expect(canTransition('pending', to)).toBe(true);
    }
  });

  it('permits partial → answered and partial → unknown_to_informant only', async () => {
    expect(canTransition('partial', 'answered')).toBe(true);
    expect(canTransition('partial', 'unknown_to_informant')).toBe(true);
    // partial may NOT go to not_applicable or back to pending
    expect(canTransition('partial', 'not_applicable')).toBe(false);
    expect(canTransition('partial', 'pending')).toBe(false);
  });

  it('treats terminal states as immutable, with one deliberate exception', async () => {
    for (const from of [
      'answered',
      'unknown_to_informant',
      'not_applicable',
    ] as CoverageStateValue[]) {
      expect(isTerminal(from)).toBe(true);
      for (const to of [
        'pending',
        'partial',
        'answered',
        'unknown_to_informant',
        'not_applicable',
      ] as CoverageStateValue[]) {
        // The exception: `answered` is derived from the checklist since R1, so an
        // honest "not mine to answer" must be able to override it (DL.58).
        const allowed = from === 'answered' && to === 'unknown_to_informant';
        expect(canTransition(from, to), `${from} → ${to}`).toBe(allowed);
      }
    }
  });

  // The live-eval failure this exists to prevent: a rambling informant let the
  // checklist close facet 9 from adjacent material, so the facet read `answered`
  // while a retarget finding said nobody actually knew.
  it('lets an honest unknown correct derived coverage, but never the reverse', async () => {
    expect(canTransition('answered', 'unknown_to_informant')).toBe(true);
    expect(canTransition('unknown_to_informant', 'answered')).toBe(false);
  });

  it('assertTransition throws IllegalCoverageTransitionError on an illegal move', async () => {
    expect(() => assertTransition('answered', 'partial')).toThrow(IllegalCoverageTransitionError);
    expect(() => assertTransition('pending', 'answered')).not.toThrow();
  });

  it('isResolved / allResolved reflect terminal states (no silent gaps)', async () => {
    expect(isResolved('pending')).toBe(false);
    expect(isResolved('partial')).toBe(false);
    expect(isResolved('answered')).toBe(true);
    expect(allResolved(['answered', 'unknown_to_informant', 'not_applicable'])).toBe(true);
    expect(allResolved(['answered', 'partial'])).toBe(false);
  });
});
