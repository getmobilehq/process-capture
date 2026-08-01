CREATE TABLE `element_states` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`facet_id` integer NOT NULL,
	`element_id` text NOT NULL,
	`state` text DEFAULT 'outstanding' NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`na_reason` text DEFAULT '' NOT NULL,
	`updated_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `element_states_session_element_unique` ON `element_states` (`session_id`,`element_id`);--> statement-breakpoint
CREATE INDEX `element_states_session_facet_idx` ON `element_states` (`session_id`,`facet_id`);