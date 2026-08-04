CREATE TABLE "answer_drafts" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"seq" integer NOT NULL,
	"take" integer DEFAULT 1 NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"origin" text DEFAULT 'typed' NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coverage_states" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"facet_id" integer NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "element_states" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"facet_id" integer NOT NULL,
	"element_id" text NOT NULL,
	"state" text DEFAULT 'outstanding' NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"na_reason" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entities" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"canonical_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"origin" text DEFAULT 'interview' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entity_mentions" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"entity_id" text NOT NULL,
	"facet_id" integer NOT NULL,
	"source" text DEFAULT 'other' NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "findings" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"session_id" text,
	"facet_id" integer NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"routed_to" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interviewees" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"full_name" text NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"invite_token" text NOT NULL,
	"status" text DEFAULT 'invited' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "process_graphs" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"spec_version" integer NOT NULL,
	"kind" text NOT NULL,
	"graph" jsonb NOT NULL,
	"change_set" jsonb,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"department" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"target_processes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"interviewee_id" text NOT NULL,
	"project_id" text NOT NULL,
	"process_name" text,
	"status" text DEFAULT 'open' NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"duration_sec" integer DEFAULT 0 NOT NULL,
	"turn_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "specs" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"version" integer NOT NULL,
	"markdown" text NOT NULL,
	"coverage_summary" jsonb NOT NULL,
	"open_items" jsonb NOT NULL,
	"generated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "statements" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"facet_id" integer NOT NULL,
	"content" text NOT NULL,
	"kind" text NOT NULL,
	"verbatim" boolean DEFAULT false NOT NULL,
	"supersedes_id" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "turns" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"seq" integer NOT NULL,
	"speaker" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "answer_drafts" ADD CONSTRAINT "answer_drafts_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coverage_states" ADD CONSTRAINT "coverage_states_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "element_states" ADD CONSTRAINT "element_states_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_mentions" ADD CONSTRAINT "entity_mentions_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_mentions" ADD CONSTRAINT "entity_mentions_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interviewees" ADD CONSTRAINT "interviewees_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_graphs" ADD CONSTRAINT "process_graphs_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_interviewee_id_interviewees_id_fk" FOREIGN KEY ("interviewee_id") REFERENCES "public"."interviewees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specs" ADD CONSTRAINT "specs_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statements" ADD CONSTRAINT "statements_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turns" ADD CONSTRAINT "turns_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "answer_drafts_session_idx" ON "answer_drafts" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "answer_drafts_session_seq_take_unique" ON "answer_drafts" USING btree ("session_id","seq","take");--> statement-breakpoint
CREATE UNIQUE INDEX "coverage_session_facet_unique" ON "coverage_states" USING btree ("session_id","facet_id");--> statement-breakpoint
CREATE UNIQUE INDEX "element_states_session_element_unique" ON "element_states" USING btree ("session_id","element_id");--> statement-breakpoint
CREATE INDEX "element_states_session_facet_idx" ON "element_states" USING btree ("session_id","facet_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entities_project_kind_key_unique" ON "entities" USING btree ("project_id","kind","canonical_key");--> statement-breakpoint
CREATE INDEX "entities_project_kind_idx" ON "entities" USING btree ("project_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "entity_mentions_session_entity_facet_unique" ON "entity_mentions" USING btree ("session_id","entity_id","facet_id");--> statement-breakpoint
CREATE INDEX "entity_mentions_session_idx" ON "entity_mentions" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "findings_project_idx" ON "findings" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "findings_session_idx" ON "findings" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "interviewees_invite_token_unique" ON "interviewees" USING btree ("invite_token");--> statement-breakpoint
CREATE INDEX "interviewees_project_idx" ON "interviewees" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "process_graphs_session_version_kind_unique" ON "process_graphs" USING btree ("session_id","spec_version","kind");--> statement-breakpoint
CREATE INDEX "process_graphs_session_idx" ON "process_graphs" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "sessions_interviewee_idx" ON "sessions" USING btree ("interviewee_id");--> statement-breakpoint
CREATE INDEX "sessions_project_idx" ON "sessions" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "specs_session_version_unique" ON "specs" USING btree ("session_id","version");--> statement-breakpoint
CREATE INDEX "specs_session_idx" ON "specs" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "statements_session_facet_idx" ON "statements" USING btree ("session_id","facet_id");--> statement-breakpoint
CREATE UNIQUE INDEX "turns_session_seq_unique" ON "turns" USING btree ("session_id","seq");