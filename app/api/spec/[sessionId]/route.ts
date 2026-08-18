import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { isValidSession } from '@/lib/auth';
import { getLatestSpec, getSession, getSpec } from '@/lib/db/queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Download a session's generated specification as Markdown (FR-5.4). */
export async function GET(req: Request, { params }: { params: { sessionId: string } }) {
  // Console-only: this returns a named person's attributed account of their job.
  // Every sibling route under /api/spec checks this; the omission here was a gap,
  // not a decision.
  if (!isValidSession(cookies().get('pc_admin')?.value)) {
    return NextResponse.json({ error: 'Not authorised' }, { status: 401 });
  }
  const session = await getSession(params.sessionId);
  if (!session) return NextResponse.json({ error: 'Unknown session' }, { status: 404 });

  const url = new URL(req.url);
  const vParam = url.searchParams.get('v');
  const spec = vParam ? await getSpec(params.sessionId, Number(vParam)) : await getLatestSpec(params.sessionId);

  if (!spec) return NextResponse.json({ error: 'No specification for this session' }, { status: 404 });

  const safeProcess = (session.processName ?? 'process').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const filename = `spec-${safeProcess}-v${spec.version}.md`;

  return new NextResponse(spec.markdown, {
    status: 200,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
