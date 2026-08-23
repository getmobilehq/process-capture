import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The verifier is the thing under test, so the only thing mocked is Google's
// signature check — everything after it (audience, identity, the permitted list)
// is ours and runs for real.
// `vi.hoisted` because vi.mock's factory is lifted above the file's own consts,
// and a plain `const` referenced inside it is not initialised when it runs.
const { verifyIdToken } = vi.hoisted(() => ({ verifyIdToken: vi.fn() }));
vi.mock('google-auth-library', () => ({
  OAuth2Client: class {
    verifyIdToken = verifyIdToken;
  },
}));

import { retentionCaller, retentionEnabled } from '@/lib/retention-auth';

const SCHEDULER = 'magpie-scheduler@magpie-505120.iam.gserviceaccount.com';

function req(headers: Record<string, string> = {}): Request {
  return new Request('https://internal/api/admin/retention', {
    method: 'POST',
    headers: { host: 'magpie.example', 'x-forwarded-proto': 'https', ...headers },
  });
}

/** What a Google-verified ticket looks like once the signature has passed. */
function ticket(payload: Record<string, unknown>) {
  return { getPayload: () => payload };
}

const env = { ...process.env };

beforeEach(() => {
  verifyIdToken.mockReset();
  process.env.RETENTION_CALLERS = SCHEDULER;
  delete process.env.RETENTION_AUDIENCE;
});
afterEach(() => {
  process.env = { ...env };
});

describe('retention sweep authorisation', () => {
  it('does not exist until someone names who may run it', () => {
    delete process.env.RETENTION_CALLERS;
    expect(retentionEnabled()).toBe(false);
    process.env.RETENTION_CALLERS = SCHEDULER;
    expect(retentionEnabled()).toBe(true);
  });

  it('accepts the scheduler, and tells the caller who it decided it was', async () => {
    verifyIdToken.mockResolvedValue(ticket({ email: SCHEDULER, email_verified: true }));
    const caller = await retentionCaller(req({ authorization: `Bearer good.token.here` }));
    expect(caller).toEqual({ email: SCHEDULER });
    // Bound to this deployment: a token minted for another service does not work
    // here, because the audience it was asked for is checked.
    expect(verifyIdToken).toHaveBeenCalledWith(
      expect.objectContaining({ audience: 'https://magpie.example' }),
    );
  });

  it('prefers an explicit audience when a custom domain fronts the service', async () => {
    process.env.RETENTION_AUDIENCE = 'https://magpie-abc123-nw.a.run.app';
    verifyIdToken.mockResolvedValue(ticket({ email: SCHEDULER, email_verified: true }));
    await retentionCaller(req({ authorization: 'Bearer good.token.here' }));
    expect(verifyIdToken).toHaveBeenCalledWith(
      expect.objectContaining({ audience: 'https://magpie-abc123-nw.a.run.app' }),
    );
  });

  it('refuses a verified identity that is not on the list', async () => {
    verifyIdToken.mockResolvedValue(
      ticket({ email: 'someone-else@magpie-505120.iam.gserviceaccount.com', email_verified: true }),
    );
    expect(await retentionCaller(req({ authorization: 'Bearer good.token.here' }))).toBeNull();
  });

  it('refuses a token Google will not vouch for', async () => {
    verifyIdToken.mockRejectedValue(new Error('Invalid token signature'));
    expect(await retentionCaller(req({ authorization: 'Bearer forged' }))).toBeNull();
  });

  it('refuses an unverified address, however plausible', async () => {
    verifyIdToken.mockResolvedValue(ticket({ email: SCHEDULER, email_verified: false }));
    expect(await retentionCaller(req({ authorization: 'Bearer good.token.here' }))).toBeNull();
  });

  it('refuses a request carrying nothing at all, without calling out to Google', async () => {
    expect(await retentionCaller(req())).toBeNull();
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  it('matches the identity case-insensitively, as addresses are', async () => {
    process.env.RETENTION_CALLERS = `Someone.Named@virginmediao2.co.uk, ${SCHEDULER}`;
    verifyIdToken.mockResolvedValue(
      ticket({ email: 'someone.named@virginmediao2.co.uk', email_verified: true }),
    );
    expect(await retentionCaller(req({ authorization: 'Bearer good.token.here' }))).toEqual({
      email: 'someone.named@virginmediao2.co.uk',
    });
  });
});
