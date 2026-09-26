CREATE TABLE `partial_settlements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `partial_settlements_event_id_idx` ON `partial_settlements` (`event_id`);--> statement-breakpoint
ALTER TABLE `payments` ADD `partial_settlement_id` integer;