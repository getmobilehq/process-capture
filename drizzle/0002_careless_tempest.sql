CREATE TABLE `entities` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`canonical_key` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`origin` text DEFAULT 'interview' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entities_project_kind_key_unique` ON `entities` (`project_id`,`kind`,`canonical_key`);--> statement-breakpoint
CREATE INDEX `entities_project_kind_idx` ON `entities` (`project_id`,`kind`);--> statement-breakpoint
CREATE TABLE `entity_mentions` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`entity_id` text NOT NULL,
	`facet_id` integer NOT NULL,
	`source` text DEFAULT 'other' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entity_mentions_session_entity_facet_unique` ON `entity_mentions` (`session_id`,`entity_id`,`facet_id`);--> statement-breakpoint
CREATE INDEX `entity_mentions_session_idx` ON `entity_mentions` (`session_id`);