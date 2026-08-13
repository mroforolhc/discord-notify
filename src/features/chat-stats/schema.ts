import {
  sqliteTable,
  integer,
  text,
  index,
  uniqueIndex,
  primaryKey,
  foreignKey,
} from "drizzle-orm/sqlite-core";

export const messages = sqliteTable(
  "messages",
  {
    pk: integer("pk").primaryKey({ autoIncrement: true }),
    chatId: integer("chat_id").notNull(), // bot-API форма: -100<id> для супергрупп
    messageId: integer("message_id").notNull(), // id внутри чата
    dateUnix: integer("date_unix").notNull(),
    editedUnix: integer("edited_unix"),

    authorId: integer("author_id"), // числовой id без префикса; NULL у части service
    authorPeer: text("author_peer"), // 'user' | 'channel'
    authorName: text("author_name"), // снимок имени на момент сообщения

    kind: text("kind").notNull(), // 'message' | 'service'
    action: text("action"), // для service: 'invite_members' и т.п.

    text: text("text"), // плоский текст
    entitiesJson: text("entities_json"), // сырой массив entity (ссылки/меншены/формат)

    mediaType: text("media_type"), // photo|video_file|animation|sticker|video_message|voice_message|audio_file|document
    mimeType: text("mime_type"),
    fileName: text("file_name"),
    fileSize: integer("file_size"),
    durationSec: integer("duration_sec"),
    width: integer("width"),
    height: integer("height"),

    viaBot: text("via_bot"), // '@elinksbot'
    forwardedFrom: text("forwarded_from"),
    forwardedFromId: text("forwarded_from_id"),
    replyToId: integer("reply_to_id"),

    source: text("source").notNull(), // 'export' | 'live'
  },
  (t) => [
    uniqueIndex("ux_messages_chat_msg").on(t.chatId, t.messageId),
    index("ix_messages_author_date").on(t.authorId, t.dateUnix),
    index("ix_messages_date").on(t.dateUnix),
    index("ix_messages_media").on(t.mediaType),
    index("ix_messages_viabot").on(t.viaBot),
  ],
);

export const reactionTotals = sqliteTable(
  "reaction_totals",
  {
    chatId: integer("chat_id").notNull(),
    messageId: integer("message_id").notNull(),
    emojiKey: text("emoji_key").notNull(), // emoji или 'custom:<id>'
    reactionKind: text("reaction_kind").notNull(), // 'emoji' | 'custom_emoji'
    emoji: text("emoji"),
    customEmojiId: text("custom_emoji_id"),
    count: integer("count").notNull(),
    source: text("source").notNull(), // 'export' | 'live'
  },
  (t) => [
    primaryKey({ columns: [t.chatId, t.messageId, t.emojiKey] }),
    foreignKey({
      columns: [t.chatId, t.messageId],
      foreignColumns: [messages.chatId, messages.messageId],
    }).onDelete("cascade"),
  ],
);

export const messageLinks = sqliteTable(
  "message_links",
  {
    pk: integer("pk").primaryKey({ autoIncrement: true }),
    chatId: integer("chat_id").notNull(),
    messageId: integer("message_id").notNull(),
    url: text("url").notNull(),
    domain: text("domain"),
  },
  (t) => [
    index("ix_links_domain").on(t.domain),
    foreignKey({
      columns: [t.chatId, t.messageId],
      foreignColumns: [messages.chatId, messages.messageId],
    }).onDelete("cascade"),
  ],
);

export type NewMessage = typeof messages.$inferInsert;
export type NewReactionTotal = typeof reactionTotals.$inferInsert;
export type NewMessageLink = typeof messageLinks.$inferInsert;
