/**
 * Where this instance believes it lives, for minting invite links.
 *
 * `BASE_URL` wins when it is set — an explicit setting should always beat a
 * guess, and a custom domain is exactly that setting. When it is not set we read
 * the origin off the request the architect is already making, which removes a
 * genuine deployment awkwardness: the platform assigns a URL at create time, so
 * configuring it ahead of time means either deploying twice or hard-coding a URL
 * nobody has yet. Deriving it means one deploy, and links that match whichever
 * hostname the architect actually reached the console on.
 *
 * Server-side only — it reads request headers.
 */
import { headers } from 'next/headers';
import { config } from './config';

export function originFromRequest(): string {
  if (process.env.BASE_URL) return config.baseUrl.replace(/\/+$/, '');

  const h = headers();
  // Cloud Run and every other managed proxy terminate TLS and forward these.
  const host = h.get('x-forwarded-host') ?? h.get('host');
  if (!host) return config.baseUrl.replace(/\/+$/, '');

  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}
