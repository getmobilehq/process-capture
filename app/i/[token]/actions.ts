'use server';

import { redirect } from 'next/navigation';
import { startSession, EntryError } from '@/lib/entry';

/**
 * Start (or resume) the interview for a token, persisting any edits to the
 * prefilled identity, then redirect into the interview. Server action invoked by
 * the entry form.
 */
export function startInterview(formData: FormData): Promise<void> {
  const token = String(formData.get('token') ?? '');
  const processRaw = formData.get('processName');
  const processName = processRaw ? String(processRaw) : null;

  try {
    startSession({
      token,
      processName: processName === '__something_else__' ? null : processName,
      fullName: str(formData.get('fullName')),
      email: str(formData.get('email')),
      role: str(formData.get('role')),
    });
  } catch (err) {
    if (err instanceof EntryError) {
      // A dead-end raced the form (link used up meanwhile) — bounce to the page,
      // which will render the polite dead-end state.
      redirect(`/i/${token}`);
    }
    throw err;
  }

  redirect(`/i/${token}/interview`);
}

function str(v: FormDataEntryValue | null): string | undefined {
  return v == null ? undefined : String(v);
}
