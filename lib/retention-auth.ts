/**
 * Who is allowed to trigger the retention sweep.
 *
 * It used to be a shared token that Cloud Scheduler sent in a header. That token
 * had to sit in the scheduler job's configuration in clear text, where anyone
 * with `cloudscheduler.jobs.get` on the project could read it — and it was in
 * Terraform state and plan output besides. A shared secret that half a dozen
 * viewers can read is not a secret, and this endpoint deletes interview content.
 *
 * The caller now proves who it *is* rather than what it knows. Cloud Scheduler
 * already sends a Google-signed OIDC token; this verifies the signature against
 * Google's keys, checks the audience is this service, and checks the identity is
 * on the permitted list. Nothing to rotate, nothing to leak, and the audit trail
 * names the account.
 *
 * `google-auth-library` is already a direct dependency — it is how Vertex
 * authenticates — so this adds no new one (P6).
 *
 * With `RETENTION_CALLERS` unset the endpoint does not exist at all. A
 * destructive route should be absent until someone deliberately turns it on,
 * rather than merely unprotected.
 */
import { OAuth2Client } from 'google-auth-library';

const client = new OAuth2Client();

export function retentionEnabled(): boolean {
  return permittedCallers().length > 0;
}

function permittedCallers(): string[] {
  return (process.env.RETENTION_CALLERS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * What audience the token must carry.
 *
 * The scheduler is configured with this service's URL, so the token is bound to
 * *this* deployment: one lifted from another service's traffic will not verify
 * here. `RETENTION_AUDIENCE` overrides it for the case where a custom domain sits
 * in front and the scheduler targets the run URL — set it to whatever the
 * scheduler actually names.
 *
 * Otherwise it is derived from the forwarded host, which is the address the
 * request arrived on. Cloud Run routes by host, so this is not a value a caller
 * can invent and have reach us.
 */
function expectedAudience(req: Request): string | null {
  if (process.env.RETENTION_AUDIENCE) return process.env.RETENTION_AUDIENCE;
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (!host) return null;
  const proto = req.headers.get('x-forwarded-proto') ?? 'https';
  return `${proto}://${host}`;
}

export interface RetentionCaller {
  email: string;
}

/**
 * Verify the bearer token and return who sent it, or null.
 *
 * Failures are deliberately indistinguishable to the caller — an unverified
 * signature, a wrong audience and an identity that is simply not on the list all
 * produce the same 401. Telling an unauthorised caller *which* check it failed is
 * telling it how to pass.
 */
export async function retentionCaller(req: Request): Promise<RetentionCaller | null> {
  const allowed = permittedCallers();
  if (allowed.length === 0) return null;

  const idToken = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!idToken) return null;

  const audience = expectedAudience(req);
  if (!audience) return null;

  try {
    const ticket = await client.verifyIdToken({ idToken, audience });
    const payload = ticket.getPayload();
    const email = payload?.email?.toLowerCase();
    if (!email || payload?.email_verified !== true) return null;
    if (!allowed.includes(email)) return null;
    return { email };
  } catch {
    // A malformed or unverifiable token is not an error worth a stack trace; it
    // is the ordinary case of somebody knocking.
    return null;
  }
}
