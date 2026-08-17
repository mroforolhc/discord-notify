import { escapeHtml } from "./messages.js";

const HTML = { parse_mode: "HTML" };
const RECENT_LIMIT = 15;

// Интерактивное задавание имени/пола через Telegram: /people и /who дают список
// кнопок (по @username различаем одинаковые ники), тап открывает карточку-редактор
// с аватаром, тумблером пола и кнопкой имени. Discord id всё время едет в
// callback_data и пользователю не показывается.
export function registerNaming({ telegram, discord, people, config }) {
  // id -> { displayName, username, avatarUrl, lastSeen } для всех, кого видели.
  const directory = new Map();
  // message_id force_reply-промпта -> { id, cardMessageId } — чей ответ ждём.
  const pending = new Map();

  function remember(meta) {
    directory.set(meta.memberId ?? meta.id, {
      displayName: meta.memberName ?? meta.displayName,
      username: meta.username,
      avatarUrl: meta.avatarUrl,
      lastSeen: Date.now(),
    });
  }

  discord.emitter.on("voiceEvent", remember);

  function inChat(ctx) {
    return String(ctx.chat?.id) === String(config.telegramChatId);
  }

  // Разрешаем только из целевого чата и только админам из allowlist (.env).
  // Пустой список = никто, пока id не прописаны.
  function allowed(ctx) {
    return inChat(ctx) && config.adminUserIds.includes(String(ctx.from?.id));
  }

  function personLabel(id, meta) {
    const mark = people.get(id) ? "✏️" : "＋";
    return `${mark} ${meta.displayName} · @${meta.username}`;
  }

  function listKeyboard(ids) {
    return {
      inline_keyboard: ids.map((id) => [
        { text: personLabel(id, directory.get(id)), callback_data: `pick:${id}` },
      ]),
    };
  }

  function cardCaption(id) {
    const meta = directory.get(id) ?? {};
    const p = people.get(id);
    const gender =
      p?.gender === "m" ? "мужской" : p?.gender === "f" ? "женский" : "— не задан";
    return [
      `<b>@${escapeHtml(meta.username ?? "?")}</b>`,
      `ник на сервере: ${escapeHtml(meta.displayName ?? "—")}`,
      `имя: ${p?.name ? escapeHtml(p.name) : "— не задано"}`,
      `пол: ${gender}`,
    ].join("\n");
  }

  function cardKeyboard(id) {
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
      const ids = [];
      for (const m of members) {
        remember(m);
        if (!ids.includes(m.id)) ids.push(m.id);
      }
      if (ids.length === 0) {
        telegram.sendMessage("Сейчас в войсе никого нет");
        return;
      }
      telegram.sendMessage("🎧 Кого назвать?", {
        reply_markup: listKeyboard(ids),
      });
    }

    if (command === "/who") {
      const ids = [...directory.entries()]
        .sort((a, b) => b[1].lastSeen - a[1].lastSeen)
        .slice(0, RECENT_LIMIT)
        .map(([id]) => id);
      if (ids.length === 0) {
        telegram.sendMessage("Ещё никого не видел в войсе");
        return;
      }
      telegram.sendMessage("👀 Недавно в войсе:", {
        reply_markup: listKeyboard(ids),
      });
    }
  });

  telegram.emitter.on("callback", async (data, ctx) => {
    if (!inChat(ctx)) return;
    const answer = (text) => telegram.answerCallback(ctx.callbackQuery.id, text);
    if (!allowed(ctx)) {
      await answer("Только для админов"); // гасим часики, а не молча игнорим
      return;
    }

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
      const current = people.get(id)?.gender;
      people.set(id, { gender: current === g ? undefined : g }); // тап по активному снимает
      await telegram.editMessageCaption(
        ctx.callbackQuery.message.message_id,
        cardCaption(id),
        { reply_markup: cardKeyboard(id), ...HTML },
      );
      await answer(current === g ? "Пол снят" : "Пол задан");
      return;
    }

    if (data.startsWith("name:")) {
      const id = data.slice(5);
      const meta = directory.get(id) ?? {};
      const prompt = await telegram.sendMessage(
        `Имя для @${escapeHtml(meta.username ?? "?")}?`,
        {
          reply_markup: { force_reply: true, input_field_placeholder: "Имя" },
          ...HTML,
        },
      );
      if (prompt) {
        pending.set(prompt.message_id, {
          id,
          cardMessageId: ctx.callbackQuery.message.message_id,
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
    if (replyId == null || !pending.has(replyId)) return;

    const { id, cardMessageId } = pending.get(replyId);
    pending.delete(replyId);

    const name = ctx.message.text?.trim();
    if (!name) return;

    people.set(id, { name });
    telegram.editMessageCaption(cardMessageId, cardCaption(id), {
      reply_markup: cardKeyboard(id),
      ...HTML,
    });
    telegram.sendMessage(`✅ Готово: ${escapeHtml(name)}`, HTML);
  });
}
