CREATE TABLE `reaction_events` (
	`pk` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chat_id` integer NOT NULL,
	`message_id` integer NOT NULL,
	`actor_id` integer,
	`actor_name` text,
	`actor_peer` text,
	`reaction_kind` text NOT NULL,
	`emoji` text,
	`custom_emoji_id` text,
	`emoji_key` text NOT NULL,
	`action` text NOT NULL,
	`date_unix` integer NOT NULL,
	`source` text DEFAULT 'live' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_react_ev` ON `reaction_events` (`chat_id`,`message_id`,`actor_id`,`emoji_key`,`action`,`date_unix`);--> statement-breakpoint
CREATE INDEX `ix_react_ev_actor` ON `reaction_events` (`actor_id`);--> statement-breakpoint
CREATE INDEX `ix_react_ev_msg` ON `reaction_events` (`chat_id`,`message_id`);--> statement-breakpoint
CREATE INDEX `ix_react_ev_date` ON `reaction_events` (`date_unix`);