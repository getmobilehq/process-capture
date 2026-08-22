import { describe, it, expect } from 'vitest';
import { isSameOrigin, rejectCrossOrigin } from '@/lib/origin';

function req(headers: Record<string, string>): Request {
  return new Request('http://internal/api/anything', { method: 'POST', headers });
}

describe('cross-site request forgery guard', () => {
  it('accepts a post from a page this app served', () => {
    expect(isSameOrigin(req({ host: 'magpie.example', origin: 'https://magpie.example' }))).toBe(true);
  });

  it('accepts the Referer when a browser sends no Origin', () => {
    expect(
      isSameOrigin(req({ host: 'magpie.example', referer: 'https://magpie.example/console/login' })),
    ).toBe(true);
  });

  it("compares against the proxy's host, not the container's", () => {
    // Behind Cloud Run `host` is the internal name and would never match the
    // browser. Getting this backwards refuses every real request.
    expect(
      isSameOrigin(
        req({
          host: 'localhost:8080',
          'x-forwarded-host': 'magpie.example',
          origin: 'https://magpie.example',
        }),
      ),
    ).toBe(true);
  });

  it('refuses another site posting with the browser attaching our cookies', () => {
    expect(isSameOrigin(req({ host: 'magpie.example', origin: 'https://evil.example' }))).toBe(false);
    // A look-alike prefix is still another host.
    expect(isSameOrigin(req({ host: 'magpie.example', origin: 'https://magpie.example.evil' }))).toBe(
      false,
    );
  });

  it('fails closed when nothing states where the request came from', () => {
    expect(isSameOrigin(req({ host: 'magpie.example' }))).toBe(false);
    expect(isSameOrigin(req({ origin: 'https://magpie.example' }))).toBe(false);
  });

  it('returns a 403 that names the reason without naming internals', async () => {
    const res = rejectCrossOrigin(req({ host: 'magpie.example', origin: 'https://evil.example' }));
    expect(res?.status).toBe(403);
    await expect(res?.json()).resolves.toEqual({ error: 'Request did not come from this site.' });
    expect(rejectCrossOrigin(req({ host: 'a.example', origin: 'https://a.example' }))).toBeNull();
  });
});
