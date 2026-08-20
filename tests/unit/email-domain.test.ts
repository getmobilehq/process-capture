import { describe, it, expect } from 'vitest';
import { domainOf, nearMissDomain } from '@/lib/email-domain';

const EXISTING = ['priya@virginmediao2.co.uk', 'tom@virginmediao2.co.uk'];

describe('near-miss domains (the o2 case)', () => {
  // The exact mistake that happened: two accounts created at virginmedia.co.uk
  // by someone who believed they had typed virginmediao2.co.uk.
  it('spots a domain that is a truncation of one already in use', () => {
    expect(nearMissDomain('joseph.agunbiade@virginmedia.co.uk', EXISTING)).toBe(
      'virginmediao2.co.uk',
    );
  });

  it('says nothing when the domain is already in use', () => {
    expect(nearMissDomain('new.person@virginmediao2.co.uk', EXISTING)).toBeNull();
  });

  it('spots a small typo', () => {
    expect(nearMissDomain('x@virginmediao2.co.zk', EXISTING)).toBe('virginmediao2.co.uk');
  });

  // A genuinely different organisation must not be queried, or the warning
  // becomes noise and gets clicked through.
  it('says nothing about an unrelated domain', () => {
    expect(nearMissDomain('consultant@accenture.com', EXISTING)).toBeNull();
    expect(nearMissDomain('joe@univelcity.com', EXISTING)).toBeNull();
  });

  it('says nothing when there is nothing to compare against', () => {
    expect(nearMissDomain('first@anywhere.com', [])).toBeNull();
  });

  it('reads the domain from the last @, so a quoted local part cannot fool it', () => {
    expect(domainOf('odd@name@example.com')).toBe('example.com');
    expect(domainOf('not-an-email')).toBe('');
  });
});
