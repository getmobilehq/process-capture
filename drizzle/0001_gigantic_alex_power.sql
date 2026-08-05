CREATE TABLE "change_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"spec_version" integer NOT NULL,
	"change_index" integer NOT NULL,
	"verdict" text NOT NULL,
	"edited_description" text,
	"edited_rationale" text,
	"note" text DEFAULT '' NOT NULL,
	"reviewer" text NOT NULL,
	"reviewed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "change_reviews" ADD CONSTRAINT "change_reviews_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "change_reviews_session_version_index_unique" ON "change_reviews" USING btree ("session_id","spec_version","change_index");--> statement-breakpoint
CREATE INDEX "change_reviews_session_idx" ON "change_reviews" USING btree ("session_id");