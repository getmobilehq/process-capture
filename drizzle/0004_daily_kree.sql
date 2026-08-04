CREATE TABLE `process_graphs` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`spec_version` integer NOT NULL,
	`kind` text NOT NULL,
	`graph` text NOT NULL,
	`change_set` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `process_graphs_session_version_kind_unique` ON `process_graphs` (`session_id`,`spec_version`,`kind`);--> statement-breakpoint
CREATE INDEX `process_graphs_session_idx` ON `process_graphs` (`session_id`);