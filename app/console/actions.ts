'use server';

import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/console-auth';
import {
  addInterviewee,
  createProject,
  raiseFinding,
  updateFinding,
} from '@/lib/db/queries';

function parseProcesses(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function createProjectAction(formData: FormData): Promise<void> {
  requireAdmin();
  const name = String(formData.get('name') ?? '').trim();
  const department = String(formData.get('department') ?? '').trim();
  const description = String(formData.get('description') ?? '').trim();
  const targetProcesses = parseProcesses(String(formData.get('targetProcesses') ?? ''));
  if (!name || !department) redirect('/console?error=missing');

  const project = createProject({ name, department, description, targetProcesses });
  redirect(`/console/projects/${project.id}`);
}

export async function addIntervieweeAction(formData: FormData): Promise<void> {
  requireAdmin();
  const projectId = String(formData.get('projectId') ?? '');
  const fullName = String(formData.get('fullName') ?? '').trim();
  const email = String(formData.get('email') ?? '').trim();
  const role = String(formData.get('role') ?? '').trim();
  if (!projectId || !fullName || !email || !role) {
    redirect(`/console/projects/${projectId}?tab=register&error=missing`);
  }
  addInterviewee({ projectId, fullName, email, role });
  redirect(`/console/projects/${projectId}?tab=register`);
}

export async function updateFindingAction(formData: FormData): Promise<void> {
  requireAdmin();
  const projectId = String(formData.get('projectId') ?? '');
  const findingId = String(formData.get('findingId') ?? '');
  const status = formData.get('status');
  const routedTo = formData.get('routedTo');
  const patch: { status?: 'open' | 'acknowledged' | 'resolved'; routedTo?: string } = {};
  if (status) patch.status = String(status) as 'open' | 'acknowledged' | 'resolved';
  if (routedTo !== null) patch.routedTo = String(routedTo).trim();
  if (findingId) updateFinding(findingId, patch);
  redirect(`/console/projects/${projectId}?tab=findings`);
}

export async function raiseConflictAction(formData: FormData): Promise<void> {
  requireAdmin();
  const projectId = String(formData.get('projectId') ?? '');
  const facetId = Number(formData.get('facetId'));
  const title = String(formData.get('title') ?? '').trim();
  const detail = String(formData.get('detail') ?? '').trim();
  if (projectId && Number.isInteger(facetId) && title) {
    raiseFinding({
      projectId,
      sessionId: null,
      facetId,
      type: 'candidate_conflict',
      title,
      detail,
      status: 'open',
      routedTo: '',
    });
  }
  redirect(`/console/projects/${projectId}?tab=conflicts`);
}
