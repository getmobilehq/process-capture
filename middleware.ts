import { NextResponse, type NextRequest } from 'next/server';

/**
 * Per-request Content Security Policy with a nonce.
 *
 * The policy used to say `script-src 'self' 'unsafe-inline'`, which is very
 * nearly no script policy at all: the whole point of CSP is to stop injected
 * markup from executing, and `unsafe-inline` permits exactly that. It was there
 * because Next puts its own inline bootstrap scripts on the page and they have to
 * run. A nonce solves it properly — the scripts Next emits carry the token, and
 * anything injected into the page does not.
 *
 * Next reads the nonce out of the CSP on the *request* headers and stamps it onto
 * its own scripts, which is why the policy is set in both places rather than only
 * on the response.
 *
 * `unsafe-eval` stays in development only: the dev server's hot reload needs it.
 * A pilot deployment runs `next start`, so production gets the strict policy.
 *
 * `style-src` keeps `unsafe-inline`. Inline *style attributes* are used
 * throughout the UI — coverage-rail colours, lane geometry — and unlike scripts
 * they cannot be nonced individually. It is a much smaller exposure: a style
 * attribute cannot execute.
 */
export function middleware(req: NextRequest) {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const nonce = btoa(String.fromCharCode(...bytes));

  const scriptSrc = [`'self'`, `'nonce-${nonce}'`, `'strict-dynamic'`];
  if (process.env.NODE_ENV !== 'production') scriptSrc.push(`'unsafe-eval'`, `'unsafe-inline'`);

  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "media-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    `script-src ${scriptSrc.join(' ')}`,
    "connect-src 'self'",
  ].join('; ');

  const headers = new Headers(req.headers);
  headers.set('x-nonce', nonce);
  headers.set('content-security-policy', csp);

  const res = NextResponse.next({ request: { headers } });
  res.headers.set('Content-Security-Policy', csp);
  return res;
}

export const config = {
  // Everything a browser renders. Static assets and the favicon are served with
  // no markup, so a policy on them buys nothing and costs a middleware hop.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|brand/).*)'],
};
