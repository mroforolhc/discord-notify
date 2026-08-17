import type {
  Message,
  MessageEntity,
  MessageReactionUpdated,
  ReactionType,
} from "grammy/types";
import type { NewMessage, NewMessageLink, NewReactionEvent } from "./schema.js";

export interface MappedMessage {
  message: NewMessage;
  links: Omit<NewMessageLink, "pk">[];
}

// Извлекаем автора: обычный юзер или анонимус/канал (sender_chat).
function authorFields(msg: Message): {
  authorId: number | null;
  authorPeer: string | null;
  authorName: string | null;
} {
  if (msg.from) {
    const name =
      [msg.from.first_name, msg.from.last_name].filter(Boolean).join(" ") ||
      msg.from.username ||
      null;
    return { authorId: msg.from.id, authorPeer: "user", authorName: name };
  }
  if (msg.sender_chat) {
    return {
      authorId: msg.sender_chat.id,
      authorPeer: "channel",
      authorName: msg.sender_chat.title ?? null,
    };
  }
  return { authorId: null, authorPeer: null, authorName: null };
}

function mediaFields(msg: Message): Partial<NewMessage> {
  if (msg.photo) {
    const largest = msg.photo[msg.photo.length - 1];
    return {
      mediaType: "photo",
      fileSize: largest?.file_size ?? null,
      width: largest?.width ?? null,
      height: largest?.height ?? null,
    };
  }
  if (msg.video) {
    return {
      mediaType: "video_file",
      mimeType: msg.video.mime_type ?? null,
      fileName: msg.video.file_name ?? null,
      fileSize: msg.video.file_size ?? null,
      durationSec: msg.video.duration,
      width: msg.video.width,
      height: msg.video.height,
    };
  }
  if (msg.animation) {
    return {
      mediaType: "animation",
      mimeType: msg.animation.mime_type ?? null,
      fileName: msg.animation.file_name ?? null,
      fileSize: msg.animation.file_size ?? null,
      durationSec: msg.animation.duration,
      width: msg.animation.width,
      height: msg.animation.height,
    };
  }
  if (msg.sticker) {
    return {
      mediaType: "sticker",
      fileSize: msg.sticker.file_size ?? null,
      width: msg.sticker.width,
      height: msg.sticker.height,
    };
  }
  if (msg.video_note) {
    return {
      mediaType: "video_message",
      fileSize: msg.video_note.file_size ?? null,
      durationSec: msg.video_note.duration,
    };
  }
  if (msg.voice) {
    return {
      mediaType: "voice_message",
      mimeType: msg.voice.mime_type ?? null,
      fileSize: msg.voice.file_size ?? null,
      durationSec: msg.voice.duration,
    };
  }
  if (msg.audio) {
    return {
      mediaType: "audio_file",
      mimeType: msg.audio.mime_type ?? null,
      fileName: msg.audio.file_name ?? null,
      fileSize: msg.audio.file_size ?? null,
      durationSec: msg.audio.duration,
    };
  }
  if (msg.document) {
    return {
      mediaType: "document",
      mimeType: msg.document.mime_type ?? null,
      fileName: msg.document.file_name ?? null,
      fileSize: msg.document.file_size ?? null,
    };
  }
  return {};
}

function forwardFields(msg: Message): Partial<NewMessage> {
  const origin = msg.forward_origin;
  if (!origin) return {};
  switch (origin.type) {
    case "user":
      return {
        forwardedFrom:
          [origin.sender_user.first_name, origin.sender_user.last_name]
            .filter(Boolean)
            .join(" ") || null,
        forwardedFromId: String(origin.sender_user.id),
      };
    case "hidden_user":
      return { forwardedFrom: origin.sender_user_name };
    case "chat":
      return {
        forwardedFrom: origin.sender_chat.title ?? null,
        forwardedFromId: String(origin.sender_chat.id),
      };
    case "channel":
      return {
        forwardedFrom: origin.chat.title ?? null,
        forwardedFromId: String(origin.chat.id),
      };
    default:
      return {};
  }
}

export function domainOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function extractLinks(
  chatId: number,
  messageId: number,
  text: string | null,
  entities: MessageEntity[] | undefined,
): Omit<NewMessageLink, "pk">[] {
  if (!entities) return [];
  const links: Omit<NewMessageLink, "pk">[] = [];
  for (const e of entities) {
    let url: string | null = null;
    if (e.type === "text_link") url = e.url;
    else if (e.type === "url" && text != null)
      url = text.slice(e.offset, e.offset + e.length);
    if (url) links.push({ chatId, messageId, url, domain: domainOf(url) });
  }
  return links;
}

export function mapLiveMessage(msg: Message): MappedMessage {
  const chatId = msg.chat.id;
  const messageId = msg.message_id;
  const text = msg.text ?? msg.caption ?? null;
  const entities = msg.entities ?? msg.caption_entities;

  const message: NewMessage = {
    chatId,
    messageId,
    dateUnix: msg.date,
    editedUnix: msg.edit_date ?? null,
    ...authorFields(msg),
    kind: "message",
    action: null,
    text,
    entitiesJson: entities ? JSON.stringify(entities) : null,
    ...mediaFields(msg),
    viaBot: msg.via_bot ? `@${msg.via_bot.username}` : null,
    ...forwardFields(msg),
    replyToId: msg.reply_to_message?.message_id ?? null,
    source: "live",
  };

  return { message, links: extractLinks(chatId, messageId, text, entities) };
}

// ── Реакции (message_reaction): кто что поставил/убрал ───────────────────────
function reactionKey(r: ReactionType): string {
  if (r.type === "emoji") return `e:${r.emoji}`;
  if (r.type === "custom_emoji") return `c:${r.custom_emoji_id}`;
  return "p:paid";
}

// Апдейт message_reaction → события add/remove по разнице old_reaction vs new_reaction.
export function mapReactionUpdate(
  u: MessageReactionUpdated,
): NewReactionEvent[] {
  const oldMap = new Map(u.old_reaction.map((r) => [reactionKey(r), r]));
  const newMap = new Map(u.new_reaction.map((r) => [reactionKey(r), r]));

  const actorId = u.user?.id ?? u.actor_chat?.id ?? null;
  const actorPeer = u.user ? "user" : u.actor_chat ? "chat" : null;
  const actorName = u.user
    ? [u.user.first_name, u.user.last_name].filter(Boolean).join(" ") ||
      u.user.username ||
      null
    : (u.actor_chat?.title ?? null);

  const make = (r: ReactionType, action: "add" | "remove"): NewReactionEvent => ({
    chatId: u.chat.id,
    messageId: u.message_id,
    actorId,
    actorName,
    actorPeer,
    reactionKind: r.type,
    emoji: r.type === "emoji" ? r.emoji : null,
    customEmojiId: r.type === "custom_emoji" ? r.custom_emoji_id : null,
    emojiKey: reactionKey(r),
    action,
    dateUnix: u.date,
    source: "live",
  });

  const events: NewReactionEvent[] = [];
  for (const [k, r] of newMap) if (!oldMap.has(k)) events.push(make(r, "add"));
  for (const [k, r] of oldMap) if (!newMap.has(k)) events.push(make(r, "remove"));
  return events;
}
