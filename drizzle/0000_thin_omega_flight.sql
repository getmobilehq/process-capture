CREATE TABLE `coverage_states` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`facet_id` integer NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`updated_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `coverage_session_facet_unique` ON `coverage_states` (`session_id`,`facet_id`);--> statement-breakpoint
CREATE TABLE `findings` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`session_id` text,
	`facet_id` integer NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`routed_to` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `findings_project_idx` ON `findings` (`project_id`);--> statement-breakpoint
CREATE INDEX `findings_session_idx` ON `findings` (`session_id`);--> statement-breakpoint
CREATE TABLE `interviewees` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`full_name` text NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`invite_token` text NOT NULL,
	`status` text DEFAULT 'invited' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `interviewees_invite_token_unique` ON `interviewees` (`invite_token`);--> statement-breakpoint
CREATE INDEX `interviewees_project_idx` ON `interviewees` (`project_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`department` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`target_processes` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`interviewee_id` text NOT NULL,
	`project_id` text NOT NULL,
	`process_name` text,
	`status` text DEFAULT 'open' NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`duration_sec` integer DEFAULT 0 NOT NULL,
	`turn_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`interviewee_id`) REFERENCES `interviewees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `sessions_interviewee_idx` ON `sessions` (`interviewee_id`);--> statement-breakpoint
CREATE INDEX `sessions_project_idx` ON `sessions` (`project_id`);--> statement-breakpoint
CREATE TABLE `specs` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`version` integer NOT NULL,
	`markdown` text NOT NULL,
	`coverage_summary` text NOT NULL,
	`open_items` text NOT NULL,
	`generated_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `specs_session_version_unique` ON `specs` (`session_id`,`version`);--> statement-breakpoint
CREATE INDEX `specs_session_idx` ON `specs` (`session_id`);--> statement-breakpoint
CREATE TABLE `statements` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`facet_id` integer NOT NULL,
	`content` text NOT NULL,
	`kind` text NOT NULL,
	`verbatim` integer DEFAULT false NOT NULL,
	`supersedes_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `statements_session_facet_idx` ON `statements` (`session_id`,`facet_id`);--> statement-breakpoint
CREATE TABLE `turns` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`seq` integer NOT NULL,
	`speaker` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `turns_session_seq_unique` ON `turns` (`session_id`,`seq`);