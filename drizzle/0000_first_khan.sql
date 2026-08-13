CREATE TABLE `message_links` (
	`pk` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chat_id` integer NOT NULL,
	`message_id` integer NOT NULL,
	`url` text NOT NULL,
	`domain` text,
	FOREIGN KEY (`chat_id`,`message_id`) REFERENCES `messages`(`chat_id`,`message_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_links_domain` ON `message_links` (`domain`);--> statement-breakpoint
CREATE TABLE `messages` (
	`pk` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chat_id` integer NOT NULL,
	`message_id` integer NOT NULL,
	`date_unix` integer NOT NULL,
	`edited_unix` integer,
	`author_id` integer,
	`author_peer` text,
	`author_name` text,
	`kind` text NOT NULL,
	`action` text,
	`text` text,
	`entities_json` text,
	`media_type` text,
	`mime_type` text,
	`file_name` text,
	`file_size` integer,
	`duration_sec` integer,
	`width` integer,
	`height` integer,
	`via_bot` text,
	`forwarded_from` text,
	`forwarded_from_id` text,
	`reply_to_id` integer,
	`source` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_messages_chat_msg` ON `messages` (`chat_id`,`message_id`);--> statement-breakpoint
CREATE INDEX `ix_messages_author_date` ON `messages` (`author_id`,`date_unix`);--> statement-breakpoint
CREATE INDEX `ix_messages_date` ON `messages` (`date_unix`);--> statement-breakpoint
CREATE INDEX `ix_messages_media` ON `messages` (`media_type`);--> statement-breakpoint
CREATE INDEX `ix_messages_viabot` ON `messages` (`via_bot`);--> statement-breakpoint
CREATE TABLE `reaction_totals` (
	`chat_id` integer NOT NULL,
	`message_id` integer NOT NULL,
	`emoji_key` text NOT NULL,
	`reaction_kind` text NOT NULL,
	`emoji` text,
	`custom_emoji_id` text,
	`count` integer NOT NULL,
	`source` text NOT NULL,
	PRIMARY KEY(`chat_id`, `message_id`, `emoji_key`),
	FOREIGN KEY (`chat_id`,`message_id`) REFERENCES `messages`(`chat_id`,`message_id`) ON UPDATE no action ON DELETE cascade
);
