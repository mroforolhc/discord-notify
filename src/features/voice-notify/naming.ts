import { escapeHtml } from "./messages.js";
import type { PeopleStore } from "../../people/store.js";
import type { DiscordBot } from "../../integrations/discord.js";
import type { TelegramBot } from "../../telegram/bot.js";
import type { Config } from "../../config.js";

const HTML = { parse_mode: "HTML" };
const RECENT_LIMIT = 15;

interface DirEntry {
  displayName: string;
  username: string;
  avatarUrl: string;
  lastSeen: number;
}

interface InlineKeyboard {
  inline_keyboard: { text: string; callback_data: string }[][];
}

// Интерактивное задавание имени/пола через Telegram: /people и /who дают список
// кнопок (по @username различаем одинаковые ники), тап открывает карточку-редактор
// с аватаром, тумблером пола и кнопкой имени. Discord id всё время едет в
// callback_data и пользователю не показывается.
export function registerNaming({
  telegram,
  discord,
  people,
  config,
}: {
  telegram: TelegramBot;
  discord: DiscordBot;
  people: PeopleStore;
  config: Config;
}): void {
  // id -> метаданные для всех, кого видели (для списков и карточек).
  const directory = new Map<string, DirEntry>();
  // message_id force_reply-промпта -> { id, cardMessageId } — чей ответ ждём.
  const pending = new Map<number, { id: string; cardMessageId: number }>();

  function remember(
    id: string,
    displayName: string,
    username: string,
    avatarUrl: string,
  ): DirEntry {
    const entry: DirEntry = {
      displayName,
      username,
      avatarUrl,
      lastSeen: Date.now(),
    };
    directory.set(id, entry);
    return entry;
  }

  discord.emitter.on("voiceEvent", (e) => {
    remember(e.memberId, e.memberName, e.username, e.avatarUrl);
  });

  function inChat(ctx: { chat?: { id: number } }): boolean {
    return String(ctx.chat?.id) === String(config.telegramChatId);
  }

  // Разрешаем только из целевого чата и только админам из allowlist (.env).
  // Пустой список = никто, пока id не прописаны.
  function allowed(ctx: {
    chat?: { id: number };
    from?: { id: number };
  }): boolean {
    return inChat(ctx) && config.adminUserIds.includes(String(ctx.from?.id));
  }

  function personLabel(id: string, meta: DirEntry): string {
    const mark = people.get(id) ? "✏️" : "＋";
    return `${mark} ${meta.displayName} · @${meta.username}`;
  }

  function listKeyboard(entries: [string, DirEntry][]): InlineKeyboard {
    return {
      inline_keyboard: entries.map(([id, meta]) => [
        { text: personLabel(id, meta), callback_data: `pick:${id}` },
      ]),
    };
  }

  function cardCaption(id: string): string {
    const meta = directory.get(id);
    const p = people.get(id);
    const gender =
      p?.gender === "m"
        ? "мужской"
        : p?.gender === "f"
          ? "женский"
          : "— не задан";
    return [
      `<b>@${escapeHtml(meta?.username ?? "?")}</b>`,
      `ник на сервере: ${escapeHtml(meta?.displayName ?? "—")}`,
      `имя: ${p?.name ? escapeHtml(p.name) : "— не задано"}`,
      `пол: ${gender}`,
    ].join("\n");
  }

  function cardKeyboard(id: string): InlineKeyboard {
    const g = people.get(id)?.gender;
    const named = Boolean(people.get(id)?.name);
    return {
      inline_keyboard: [
        [
          { text: g === "m" ? "✅ М" : "М", callback_data: `sex:${id}:m` },
          { text: g === "f" ? "✅ Ж" : "Ж", callback_data: `sex:${id}:f` },
        ],
        [
          {
            text: named ? "✏️ Изменить имя" : "✏️ Задать имя",
            callback_data: `name:${id}`,
          },
        ],
      ],
    };
  }

  telegram.emitter.on("command", (command, ctx) => {
    if (!allowed(ctx)) return;

    if (command === "/people") {
      const members = discord.getVoiceChannels().flatMap((c) => c.members);
      const seen = new Set<string>();
      const entries: [string, DirEntry][] = [];
      for (const m of members) {
        const entry = remember(m.id, m.displayName, m.username, m.avatarUrl);
        if (seen.has(m.id)) continue;
        seen.add(m.id);
        entries.push([m.id, entry]);
      }
      if (entries.length === 0) {
        telegram.sendMessage("Сейчас в войсе никого нет");
        return;
      }
      telegram.sendMessage("🎧 Кого назвать?", {
        reply_markup: listKeyboard(entries),
      });
    }

    if (command === "/who") {
      const entries = [...directory.entries()]
        .sort((a, b) => b[1].lastSeen - a[1].lastSeen)
        .slice(0, RECENT_LIMIT);
      if (entries.length === 0) {
        telegram.sendMessage("Ещё никого не видел в войсе");
        return;
      }
      telegram.sendMessage("👀 Недавно в войсе:", {
        reply_markup: listKeyboard(entries),
      });
    }
  });

  telegram.emitter.on("callback", async (data, ctx) => {
    if (!inChat(ctx)) return;
    const answer = (text?: string) =>
      telegram.answerCallback(ctx.callbackQuery.id, text);
    if (!allowed(ctx)) {
      await answer("Только для админов"); // гасим часики, а не молча игнорим
      return;
    }
    const cardMessage = ctx.callbackQuery.message;

    if (data.startsWith("pick:")) {
      const id = data.slice(5);
      const meta = directory.get(id);
      await answer();
      if (!meta) return;
      await telegram.sendPhoto(meta.avatarUrl, {
        caption: cardCaption(id),
        reply_markup: cardKeyboard(id),
        ...HTML,
      });
      return;
    }

    if (data.startsWith("sex:")) {
      const [, id, g] = data.split(":");
      if (!id || !g) return;
      const current = people.get(id)?.gender;
      people.set(id, { gender: current === g ? undefined : g }); // тап по активному снимает
      if (cardMessage) {
        await telegram.editMessageCaption(
          cardMessage.message_id,
          cardCaption(id),
          { reply_markup: cardKeyboard(id), ...HTML },
        );
      }
      await answer(current === g ? "Пол снят" : "Пол задан");
      return;
    }

    if (data.startsWith("name:")) {
      const id = data.slice(5);
      const meta = directory.get(id);
      const prompt = await telegram.sendMessage(
        `Имя для @${escapeHtml(meta?.username ?? "?")}?`,
        {
          reply_markup: { force_reply: true, input_field_placeholder: "Имя" },
          ...HTML,
        },
      );
      if (prompt && cardMessage) {
        pending.set(prompt.message_id, {
          id,
          cardMessageId: cardMessage.message_id,
        });
      }
      await answer();
      return;
    }
  });

  // Ответ на force_reply-промпт «Имя для …?».
  telegram.emitter.on("message", (ctx) => {
    if (!allowed(ctx)) return;
    const replyId = ctx.message.reply_to_message?.message_id;
    if (replyId == null) return;
    const entry = pending.get(replyId);
    if (!entry) return;
    pending.delete(replyId);

    const name = ctx.message.text?.trim();
    if (!name) return;

    people.set(entry.id, { name });
    telegram.editMessageCaption(entry.cardMessageId, cardCaption(entry.id), {
      reply_markup: cardKeyboard(entry.id),
      ...HTML,
    });
    telegram.sendMessage(`✅ Готово: ${escapeHtml(name)}`, HTML);
  });
}
