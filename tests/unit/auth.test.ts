import { describe, it, expect } from 'vitest';
import {
  adminEnabled,
  verifyPassword,
  sessionToken,
  isValidSession,
  recordLoginAttempt,
} from '@/lib/auth';

describe('console auth (FR-1.1)', () => {
  it('is enabled when ADMIN_PASSWORD is set', async () => {
    expect(adminEnabled()).toBe(true);
  });

  it('verifies the correct password and rejects a wrong one', async () => {
    expect(verifyPassword('test-admin')).toBe(true);
    expect(verifyPassword('nope')).toBe(false);
  });

  it('issues a session token that validates, and rejects tampering', async () => {
    const token = sessionToken();
    expect(isValidSession(token)).toBe(true);
    expect(isValidSession('forged')).toBe(false);
    expect(isValidSession(undefined)).toBe(false);
  });

  it('rate-limits repeated login attempts from one IP', async () => {
    const ip = '203.0.113.7';
    let blocked = false;
    for (let i = 0; i < 12; i += 1) {
      const r = recordLoginAttempt(ip);
      if (!r.allowed) blocked = true;
    }
    expect(blocked).toBe(true);
  });
});
