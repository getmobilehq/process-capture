/**
 * Seed the demo campaign (BUILD-REQUIREMENTS Phase 1): a "Consumer operations"
 * project with three interviewees, matching the approved demo's campaign view.
 * Idempotent — re-running does not duplicate the campaign.
 */
import { getDb } from '@/lib/db';
import { projects } from '@/lib/db/schema';
import { addInterviewee, createProject, listInterviewees } from '@/lib/db/queries';
import { eq } from 'drizzle-orm';
import { config } from '@/lib/config';

const CAMPAIGN_NAME = 'Consumer operations';

const INTERVIEWEES = [
  { fullName: 'Priya Nair', email: 'priya.nair@example.com', role: 'Complaints advisor' },
  { fullName: 'Tom Okafor', email: 'tom.okafor@example.com', role: 'Billing analyst' },
  { fullName: 'Sarah Whitfield', email: 'sarah.whitfield@example.com', role: 'Team leader' },
];

async function main() {
  const db = getDb();

  let project = db.select().from(projects).where(eq(projects.name, CAMPAIGN_NAME)).get();

  if (project) {
    console.log(`Campaign "${CAMPAIGN_NAME}" already exists (${project.id}) — skipping create.`);
  } else {
    project = await createProject(
      {
        name: CAMPAIGN_NAME,
        department: 'Consumer operations',
        description:
          'Capturing how frontline consumer-operations processes really run, ahead of the ARIS refresh.',
        targetProcesses: ['Billing complaint resolution', 'Goodwill credit approval'],
      },
      db,
    );
    console.log(`Created campaign "${CAMPAIGN_NAME}" (${project.id}).`);
  }

  const existing = await listInterviewees(project.id, db);
  const existingEmails = new Set(existing.map((i) => i.email));

  for (const person of INTERVIEWEES) {
    if (existingEmails.has(person.email)) {
      console.log(`  interviewee ${person.email} already present — skipping.`);
      continue;
    }
    const row = await addInterviewee({ projectId: project.id, ...person }, db);
    console.log(`  added ${row.fullName} (${row.role}) → ${config.baseUrl}/i/${row.inviteToken}`);
  }

  console.log('Seed complete.');
}

main();
