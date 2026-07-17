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
  it('permits every legal transition from pending', () => {
    for (const to of [
      'partial',
      'answered',
      'unknown_to_informant',
      'not_applicable',
    ] as CoverageStateValue[]) {
      expect(canTransition('pending', to)).toBe(true);
    }
  });

  it('permits partial → answered and partial → unknown_to_informant only', () => {
    expect(canTransition('partial', 'answered')).toBe(true);
    expect(canTransition('partial', 'unknown_to_informant')).toBe(true);
    // partial may NOT go to not_applicable or back to pending
    expect(canTransition('partial', 'not_applicable')).toBe(false);
    expect(canTransition('partial', 'pending')).toBe(false);
  });

  it('treats answered / unknown_to_informant / not_applicable as terminal (immutable)', () => {
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
        expect(canTransition(from, to)).toBe(false);
      }
    }
  });

  it('assertTransition throws IllegalCoverageTransitionError on an illegal move', () => {
    expect(() => assertTransition('answered', 'partial')).toThrow(IllegalCoverageTransitionError);
    expect(() => assertTransition('pending', 'answered')).not.toThrow();
  });

  it('isResolved / allResolved reflect terminal states (no silent gaps)', () => {
    expect(isResolved('pending')).toBe(false);
    expect(isResolved('partial')).toBe(false);
    expect(isResolved('answered')).toBe(true);
    expect(allResolved(['answered', 'unknown_to_informant', 'not_applicable'])).toBe(true);
    expect(allResolved(['answered', 'partial'])).toBe(false);
  });
});
