import { createReadStream, closeSync, openSync, readSync } from "node:fs";
import parserStream from "stream-json";
import { pick } from "stream-json/filters/pick.js";
import { streamArray } from "stream-json/streamers/stream-array.js";
import { sql, and, eq } from "drizzle-orm";
import { openDb } from "./db.js";
import {
  messages,
  reactionTotals,
  messageLinks,
  type NewMessage,
  type NewReactionTotal,
  type NewMessageLink,
} from "./schema.js";
import { domainOf } from "./mapper.js";

// ── Формы записей экспорта (Telegram Desktop) ───────────────────────────────
interface ExportEntity {
  type: string;
  text?: string;
  href?: string;
}
interface ExportReaction {
  type: string; // 'emoji' | 'custom_emoji'
  count: number;
  emoji?: string;
  document_id?: string;
}
interface ExportRecord {
  id: number;
  type: string; // 'message' | 'service'
  date_unixtime?: string;
  edited_unixtime?: string;
  from?: string;
  from_id?: string;
  actor?: string;
  actor_id?: string;
  action?: string;
  text_entities?: ExportEntity[];
  photo?: string;
  photo_file_size?: number;
  media_type?: string;
  mime_type?: string;
  file?: string;
  file_name?: string;
  file_size?: number;
  duration_seconds?: number;
  width?: number;
  height?: number;
  via_bot?: string;
  forwarded_from?: string;
  forwarded_from_id?: string;
  reply_to_message_id?: number;
  reactions?: ExportReaction[];
}

interface MappedExport {
  message: NewMessage;
  reactions: NewReactionTotal[];
  links: Omit<NewMessageLink, "pk">[];
}

// ── Чтение метаданных чата из «головы» файла (id + type до массива messages) ──
function readChatMeta(path: string): { id: number; type: string } {
  const fd = openSync(path, "r");
  const buf = Buffer.alloc(8192);
  const n = readSync(fd, buf, 0, buf.length, 0);
  closeSync(fd);
  const head = buf.toString("utf8", 0, n);
  const cut = head.indexOf('"messages"');
  if (cut < 0) throw new Error("Не найден ключ messages в голове файла");
  const objStr = head.slice(0, cut).trimEnd().replace(/,$/, "") + "}";
  const meta = JSON.parse(objStr) as { id: number; type: string };
  return meta;
}

// Экспортный id чата → bot-API форма (для склейки с live без дублей).
function toBotChatId(id: number, type: string): number {
  if (type.includes("supergroup") || type.includes("channel")) {
    return Number(`-100${id}`);
  }
  if (type.includes("group")) return -id; // basic group
  return id; // private
}

// 'user308552322' → { authorId: 308552322, authorPeer: 'user' }
function parsePeer(rawId?: string): {
  authorId: number | null;
  authorPeer: string | null;
} {
  if (!rawId) return { authorId: null, authorPeer: null };
  const m = /^([a-z]+)(\d+)$/.exec(rawId);
  if (!m) return { authorId: null, authorPeer: null };
  const peer = m[1] === "channel" ? "channel" : m[1] === "user" ? "user" : m[1];
  return { authorId: Number(m[2]), authorPeer: peer };
}

function flattenText(entities?: ExportEntity[]): string | null {
  if (!entities || entities.length === 0) return null;
  const s = entities.map((e) => e.text ?? "").join("");
  return s.length ? s : null;
}

function mediaFieldsExport(rec: ExportRecord): Partial<NewMessage> {
  if (rec.media_type) {
    return {
      mediaType: rec.media_type,
      mimeType: rec.mime_type ?? null,
      fileName: rec.file_name ?? null,
      fileSize: rec.file_size ?? null,
      durationSec: rec.duration_seconds ?? null,
      width: rec.width ?? null,
      height: rec.height ?? null,
    };
  }
  if (rec.photo !== undefined) {
    return {
      mediaType: "photo",
      fileSize: rec.photo_file_size ?? null,
      width: rec.width ?? null,
      height: rec.height ?? null,
    };
  }
  if (rec.file !== undefined) {
    return {
      mediaType: "document",
      mimeType: rec.mime_type ?? null,
      fileName: rec.file_name ?? null,
      fileSize: rec.file_size ?? null,
    };
  }
  return {};
}

// Реакции: только «сколько получено» (count). Кастом-эмодзи с пустым document_id
// не различимы — суммируем их под одним ключом, чтобы не потерять суммарный count
// и не словить конфликт по PK.
function reactionTotalsExport(
  chatId: number,
  messageId: number,
  reactions?: ExportReaction[],
): NewReactionTotal[] {
  if (!reactions) return [];
  const map = new Map<string, NewReactionTotal>();
  for (const r of reactions) {
    const isEmoji = r.type === "emoji";
    const emoji = isEmoji ? (r.emoji ?? null) : null;
    const customId = isEmoji ? null : (r.document_id ?? "");
    const key = isEmoji ? `e:${r.emoji ?? ""}` : `c:${customId}`;
    const existing = map.get(key);
    if (existing) {
      existing.count += r.count;
    } else {
      map.set(key, {
        chatId,
        messageId,
        emojiKey: key,
        reactionKind: r.type,
        emoji,
        customEmojiId: customId,
        count: r.count,
        source: "export",
      });
    }
  }
  return [...map.values()];
}

function linksExport(
  chatId: number,
  messageId: number,
  entities?: ExportEntity[],
): Omit<NewMessageLink, "pk">[] {
  if (!entities) return [];
  const out: Omit<NewMessageLink, "pk">[] = [];
  for (const e of entities) {
    let url: string | null = null;
    if (e.type === "text_link") url = e.href ?? null;
    else if (e.type === "link") url = e.text ?? null;
    if (url) out.push({ chatId, messageId, url, domain: domainOf(url) });
  }
  return out;
}

function mapExportRecord(rec: ExportRecord, chatId: number): MappedExport {
  const messageId = rec.id;
  const isService = rec.type === "service";
  // У сообщений автор в from/from_id, у сервисных — в actor/actor_id.
  const author = parsePeer(isService ? rec.actor_id : rec.from_id);
  const authorName = (isService ? rec.actor : rec.from) ?? null;

  const message: NewMessage = {
    chatId,
    messageId,
    dateUnix: Number(rec.date_unixtime ?? 0),
    editedUnix: rec.edited_unixtime ? Number(rec.edited_unixtime) : null,
    authorId: author.authorId,
    authorPeer: author.authorPeer,
    authorName,
    kind: isService ? "service" : "message",
    action: rec.action ?? null,
    text: flattenText(rec.text_entities),
    entitiesJson: rec.text_entities ? JSON.stringify(rec.text_entities) : null,
    ...mediaFieldsExport(rec),
    viaBot: rec.via_bot ?? null,
    forwardedFrom: rec.forwarded_from ?? null,
    forwardedFromId: rec.forwarded_from_id ?? null,
    replyToId: rec.reply_to_message_id ?? null,
    source: "export",
  };

  return {
    message,
    reactions: reactionTotalsExport(chatId, messageId, rec.reactions),
    links: linksExport(chatId, messageId, rec.text_entities),
  };
}

// ── Основной прогон ─────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("Usage: node import.js <path-to-result.json>");
    process.exit(1);
  }
  const dbPath = process.env.STATS_DB_PATH || "./data/stats.db";

  const meta = readChatMeta(inputPath);
  const chatId = toBotChatId(meta.id, meta.type);
  console.log(`Чат: id=${meta.id} type=${meta.type} → chat_id=${chatId}`);

  const db = openDb(dbPath);

  // Сырые счётчики (по мере чтения) — независимая база для сверки с БД.
  const raw = {
    message: 0,
    service: 0,
    photo: 0,
    video_file: 0,
    sticker: 0,
    elinks: 0,
    withReactions: 0,
  };
  let minId = Infinity;
  let maxId = -Infinity;
  let parsed = 0;
  let inserted = 0;

  const CHUNK = 2000;
  let chunk: ExportRecord[] = [];

  // Каждый вызов открывает отдельную транзакцию (в drizzle db.transaction
  // исполняется немедленно). Внутри — вставка чанка записей.
  const runChunk = (records: ExportRecord[]): void => {
    db.transaction((tx) => {
      for (const rec of records) {
        const mapped = mapExportRecord(rec, chatId);
        const info = tx
          .insert(messages)
          .values(mapped.message)
          .onConflictDoNothing()
          .run();
        if (info.changes > 0) {
          inserted++;
          if (mapped.reactions.length > 0) {
            tx.insert(reactionTotals)
              .values(mapped.reactions)
              .onConflictDoNothing()
              .run();
          }
          if (mapped.links.length > 0) {
            tx.insert(messageLinks).values(mapped.links).run();
          }
        }
      }
    });
  };

  const pipeline = createReadStream(inputPath)
    .pipe(parserStream())
    .pipe(pick.asStream({ filter: "messages" }))
    .pipe(streamArray.asStream());

  for await (const { value } of pipeline) {
    const rec = value as ExportRecord;

    if (rec.type === "message") raw.message++;
    else if (rec.type === "service") raw.service++;
    if (rec.photo !== undefined) raw.photo++;
    if (rec.media_type === "video_file") raw.video_file++;
    if (rec.media_type === "sticker") raw.sticker++;
    if (rec.via_bot === "@elinksbot") raw.elinks++;
    if (rec.reactions && rec.reactions.length > 0) raw.withReactions++;
    if (typeof rec.id === "number") {
      parsed++;
      if (rec.id < minId) minId = rec.id;
      if (rec.id > maxId) maxId = rec.id;
    }

    chunk.push(rec);
    if (chunk.length >= CHUNK) {
      runChunk(chunk);
      chunk = [];
      if (parsed % 50000 === 0) console.log(`  …обработано ${parsed}`);
    }
  }
  if (chunk.length > 0) runChunk(chunk);

  console.log(`\nРазобрано записей: ${parsed}, новых вставлено: ${inserted}`);

  // ── Сверка: сырьё из файла против того, что реально легло в БД (source=export)
  const dbMsgWhere = eq(messages.source, "export");
  const cnt = (extra?: ReturnType<typeof eq>): number =>
    db
      .select({ n: sql<number>`count(*)` })
      .from(messages)
      .where(extra ? and(dbMsgWhere, extra) : dbMsgWhere)
      .get()!.n;

  const dbWithReactions = db
    .select({ n: sql<number>`count(distinct ${reactionTotals.messageId})` })
    .from(reactionTotals)
    .where(eq(reactionTotals.source, "export"))
    .get()!.n;

  const rows: [string, number, number][] = [
    ["messages", raw.message, cnt(eq(messages.kind, "message"))],
    ["service", raw.service, cnt(eq(messages.kind, "service"))],
    ["photo", raw.photo, cnt(eq(messages.mediaType, "photo"))],
    ["video_file", raw.video_file, cnt(eq(messages.mediaType, "video_file"))],
    ["sticker", raw.sticker, cnt(eq(messages.mediaType, "sticker"))],
    ["via_bot @elinksbot", raw.elinks, cnt(eq(messages.viaBot, "@elinksbot"))],
    ["msgs с реакциями", raw.withReactions, dbWithReactions],
  ];

  console.log("\n=== СВЕРКА (файл → БД) ===");
  let allOk = true;
  for (const [label, fromFile, inDb] of rows) {
    const ok = fromFile === inDb;
    if (!ok) allOk = false;
    console.log(
      `${ok ? "✓" : "✗"} ${label.padEnd(20)} файл=${fromFile}  бд=${inDb}${ok ? "" : "  ← РАСХОЖДЕНИЕ"}`,
    );
  }

  const gaps = maxId - minId + 1 - parsed;
  const distinctAuthors = db
    .select({ n: sql<number>`count(distinct ${messages.authorId})` })
    .from(messages)
    .where(and(dbMsgWhere, eq(messages.authorPeer, "user")))
    .get()!.n;

  console.log(
    `\nid-диапазон: ${minId}…${maxId}, дыр в последовательности: ${gaps} (удалённые/чужие id — информационно)`,
  );
  console.log(`уникальных авторов-людей: ${distinctAuthors}`);
  console.log(allOk ? "\n✅ Всё сходится, ничего не потеряно." : "\n⚠️  Есть расхождения — см. выше.");
}

main().catch((e) => {
  console.error("Импорт упал:", e);
  process.exit(1);
});
