CREATE TABLE `answer_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`seq` integer NOT NULL,
	`take` integer DEFAULT 1 NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`origin` text DEFAULT 'typed' NOT NULL,
	`updated_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `answer_drafts_session_idx` ON `answer_drafts` (`session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `answer_drafts_session_seq_take_unique` ON `answer_drafts` (`session_id`,`seq`,`take`);