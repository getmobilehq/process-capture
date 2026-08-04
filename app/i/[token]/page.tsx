import { resolveEntry } from '@/lib/entry';
import { config } from '@/lib/config';
import { EntryScreen } from '@/components/entry/EntryScreen';
import { DeadEnd } from '@/components/entry/DeadEnd';

// Entry always reflects live DB state (token may have been used up).
export const dynamic = 'force-dynamic';

export default async function EntryPage({ params }: { params: { token: string } }) {
  const resolution = await resolveEntry(params.token);

  if (resolution.kind !== 'ok') {
    return (
      <main>
        <DeadEnd kind={resolution.kind} />
      </main>
    );
  }

  const { interviewee, project, resumable } = resolution;

  return (
    <main>
      <EntryScreen
        token={params.token}
        fullName={interviewee.fullName}
        email={interviewee.email}
        role={interviewee.role}
        department={project.department}
        targetProcesses={project.targetProcesses}
        retentionDays={config.retentionDays}
        resuming={Boolean(resumable)}
        voiceEnabled={config.voiceEnabled}
      />
    </main>
  );
}
