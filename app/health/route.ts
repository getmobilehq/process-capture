import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Liveness endpoint for the pilot host (load balancer / Docker healthcheck /
 * uptime monitor). Returns 200 with a small JSON body.
 */
export function GET() {
  return NextResponse.json({ status: 'ok', service: 'process-capture' });
}
