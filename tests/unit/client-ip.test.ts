import { describe, it, expect } from 'vitest';
import { clientIp } from '@/lib/rate-limit';

const req = (headers: Record<string, string>) => new Request('https://x/', { headers });

describe('client identification (F4 — rate limits were bypassable)', () => {
  // Google's front end APPENDS to whatever the client sent, so the first entry is
  // attacker-chosen. Taking it gave a fresh bucket per request, which defeated the
  // console brute-force limit and removed the cap on model spend.
  it('takes the last forwarded hop, not the first', () => {
    expect(clientIp(req({ 'x-forwarded-for': '1.2.3.4, 203.0.113.9' }))).toBe('203.0.113.9');
  });

  it('cannot be moved by a spoofed leading entry', () => {
    const spoofed = Array.from({ length: 50 }, (_, i) => `10.0.0.${i}`).join(', ');
    expect(clientIp(req({ 'x-forwarded-for': `${spoofed}, 198.51.100.7` }))).toBe('198.51.100.7');
  });

  it('handles a single hop, and tolerates ragged whitespace', () => {
    expect(clientIp(req({ 'x-forwarded-for': '  203.0.113.1  ' }))).toBe('203.0.113.1');
    expect(clientIp(req({ 'x-forwarded-for': '1.1.1.1,  ,2.2.2.2' }))).toBe('2.2.2.2');
  });

  it('falls back to x-real-ip, then to a constant', () => {
    expect(clientIp(req({ 'x-real-ip': '198.51.100.2' }))).toBe('198.51.100.2');
    expect(clientIp(req({}))).toBe('local');
  });
});
