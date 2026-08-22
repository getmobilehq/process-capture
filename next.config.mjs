// The Content Security Policy lives in middleware.ts, not here: it carries a
// per-request nonce, which a static header cannot. Everything below is fixed for
// every response and stays.
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
  // Microphone allowed for same-origin only (optional voice input); camera/geo off.
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  /**
   * Build output directory, overridable per process.
   *
   * A `next build` or a second `next dev` sharing `.next` with a running dev
   * server overwrites the chunks that server has open — it stays up and starts
   * serving 500s, then connection-refused, with no error in its own log. The E2E
   * suite starts its own dev server, so it gets its own directory and the two can
   * coexist.
   */
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  experimental: {
    // Enable instrumentation.ts (process-level error guards) on Next 14.2.
    instrumentationHook: true,
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
