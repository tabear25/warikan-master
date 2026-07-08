CREATE TABLE IF NOT EXISTS `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`keyword` text NOT NULL,
	`type` text DEFAULT 'other' NOT NULL,
	`start_date` text,
	`end_date` text,
	`created_at` text NOT NULL,
	`is_settled` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `events_keyword_unique` ON `events` (`keyword`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `members_event_id_idx` ON `members` (`event_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `payments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`payer_id` integer NOT NULL,
	`amount` real NOT NULL,
	`description` text NOT NULL,
	`split_member_ids` text NOT NULL,
	`split_mode` text DEFAULT 'equal' NOT NULL,
	`split_details` text,
	`schedule_item_id` integer,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `payments_event_id_idx` ON `payments` (`event_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `schedule_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`category` text NOT NULL,
	`title` text NOT NULL,
	`url` text,
	`ogp_title` text,
	`ogp_image` text,
	`ogp_description` text,
	`start_at` text,
	`end_at` text,
	`address` text,
	`memo` text,
	`metadata` text,
	`cost` real,
	`payer_id` integer,
	`payment_id` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `schedule_items_event_id_idx` ON `schedule_items` (`event_id`);