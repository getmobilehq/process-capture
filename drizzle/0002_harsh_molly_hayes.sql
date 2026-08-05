DROP INDEX "change_reviews_session_version_index_unique";--> statement-breakpoint
ALTER TABLE "change_reviews" ADD COLUMN "subject" text DEFAULT 'change' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "change_reviews_session_version_subject_index_unique" ON "change_reviews" USING btree ("session_id","spec_version","subject","change_index");