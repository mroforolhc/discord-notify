import type { Context } from "grammy";
import { sql, and, eq, gte, count } from "drizzle-orm";
import type { TelegramBot } from "../../telegram/bot.js";
import type { Config } from "../../config.js";
import { openDb } from "./db.js";
import type { StatsDb } from "./db.js";
import { messages, messageLinks } from "./schema.js";
import { mapLiveMessage } from "./mapper.js";

const DAYS = 10;

interface DayRow {
  day: string;
  c: number;
}

// Сообщения по дням за последние N суток, ВКЛЮЧАЯ сегодня (сегодня — неполный день,
// он просто прирастает новыми сообщениями). Сутки и нижнюю границу режем по фиксированному
// смещению (МСК=+3), а НЕ по 'localtime' (в UTC-контейнере оно = UTC). Нижняя граница
// привязана к полуночи МСК начала окна, а не к текущей секунде — иначе самый старый день
// был бы обрезан и «плыл» при каждом вызове.
function messagesPerDay(
  db: StatsDb,
  chatId: number,
  days: number,
  tzOffsetHours: number,
): DayRow[] {
  const offSec = tzOffsetHours * 3600;
  const tzMod = `${tzOffsetHours >= 0 ? "+" : ""}${tzOffsetHours} hours`;
  const day = sql<string>`strftime('%Y-%m-%d', ${messages.dateUnix} + ${offSec}, 'unixepoch')`;
  // Полночь МСК начала окна: сегодня − (N−1) дней (всего N суток вместе с сегодня).
  const low = sql`unixepoch(date('now', ${tzMod}, ${`-${days - 1} days`})) - ${offSec}`;
  return db
    .select({ day, c: count() })
    .from(messages)
    .where(
      and(
        eq(messages.kind, "message"),
        eq(messages.chatId, chatId),
        gte(messages.dateUnix, low),
      ),
    )
    .groupBy(day)
    .orderBy(day)
    .all();
}

// Максимальный известный message_id в чате (null, если сообщений ещё нет).
function maxMessageId(db: StatsDb, chatId: number): number | null {
  const row = db
    .select({ m: sql<number | null>`max(${messages.messageId})` })
    .from(messages)
    .where(eq(messages.chatId, chatId))
    .get();
  return row?.m ?? null;
}

function renderPerDay(rows: DayRow[], days: number): string {
  if (rows.length === 0) return `За последние ${days} дней сообщений нет.`;
  const total = rows.reduce((s, r) => s + r.c, 0);
  const lines = rows.map((r) => `${r.day}  ${r.c}`);
  return (
    `<b>Сообщений за последние ${days} дней:</b>\n` +
    `<pre>${lines.join("\n")}</pre>\n` +
    `Итого: <b>${total}</b>`
  );
}

export function registerChatStats({
  telegram,
  config,
}: {
  telegram: TelegramBot;
  config: Config;
}): void {
  const db = openDb(config.statsDbPath);
  console.log(`chat-stats: БД открыта (${config.statsDbPath})`);

  const statsChatId = Number(config.telegramChatId);

  // Детект пропусков между сессиями: запоминаем максимальный известный id на
  // старте, а на первом live-сообщении сравниваем — если id прыгнул, значит пока
  // бот был offline, что-то прошло мимо (id в супергруппе растут последовательно).
  const maxIdAtStartup = maxMessageId(db, statsChatId);
  let gapChecked = false;

  // Пишем СИНХРОННО прямо в обработчике: сообщение попадает в БД до того, как
  // апдейт будет подтверждён Телеге (persist → then ack). Идемпотентность —
  // через UNIQUE(chat_id, message_id): повторная доставка не создаёт дублей.
  telegram.emitter.on("message", (ctx: Context) => {
    const msg = ctx.message;
    if (!msg) return;

    if (!gapChecked && msg.chat.id === statsChatId) {
      gapChecked = true;
      if (maxIdAtStartup != null && msg.message_id > maxIdAtStartup + 1) {
        const missed = msg.message_id - maxIdAtStartup - 1;
        console.warn(
          `chat-stats: ⚠️ возможный пропуск ~${missed} сообщений между сессиями ` +
            `(последний известный id ${maxIdAtStartup} → пришёл ${msg.message_id})`,
        );
      }
    }

    try {
      const mapped = mapLiveMessage(msg);
      db.transaction((tx) => {
        const info = tx
          .insert(messages)
          .values(mapped.message)
          .onConflictDoNothing()
          .run();

        // Ссылки пишем только для реально новых сообщений, иначе при передоставке
        // они бы задвоились (у message_links нет UNIQUE).
        if (info.changes > 0 && mapped.links.length > 0) {
          tx.insert(messageLinks).values(mapped.links).run();
        }
      });
    } catch (error) {
      console.error("chat-stats: не удалось записать сообщение:", error);
    }
  });

  // Команда /messages — считает сообщения за последние N дней по отслеживаемому
  // чату и отвечает ТУДА, откуда пришла (написал в личку — ответит в личке).
  telegram.emitter.on("command", (command: string, ctx: Context) => {
    if (command !== "/messages") return;
    try {
      const rows = messagesPerDay(db, statsChatId, DAYS, config.statsTzOffsetHours);
      ctx.reply(renderPerDay(rows, DAYS), { parse_mode: "HTML" });
    } catch (error) {
      console.error("chat-stats: /messages не удалось:", error);
    }
  });
}
