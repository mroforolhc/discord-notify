import { startDiscordBot } from "../../integrations/discord.js";
import { createPeopleStore } from "../../people/store.js";
import { renderSessionMessage, renderVoiceStatus } from "./messages.js";

const HTML_OPTS = {
  parse_mode: "HTML",
  link_preview_options: { is_disabled: true },
};

export async function registerVoiceNotify({ telegram, config }) {
  const discord = await startDiscordBot(
    config.discordToken,
    config.inviteMaxAgeSeconds,
  );

  const people = createPeopleStore(config.peopleFile);

  // Одна живая сессия-сводка: { messageId, visits: Visit[], interrupted }.
  // Visit = { memberId, memberName, joinAt, leaveAt, lastEventAt }.
  // interrupted = кто-то написал в чат после нашего сообщения (мы больше не последние).
  let session = null;

  // Сериализация + троттлинг правок Telegram.
  let queue = Promise.resolve();
  let flushPending = false;
  let lastFlushAt = 0;

  function currentVisit(memberId, now) {
    for (let i = session.visits.length - 1; i >= 0; i--) {
      const v = session.visits[i];
      if (v.memberId === memberId) {
        return now - v.lastEventAt <= config.voiceCollapseMs ? v : null;
      }
    }
    return null;
  }

  function lineCount(v) {
    return v.joinAt != null || v.leaveAt != null ? 1 : 0;
  }

  function trim() {
    let total = session.visits.reduce((s, v) => s + lineCount(v), 0);
    while (total > config.voiceMaxLogLines && session.visits.length > 1) {
      total -= lineCount(session.visits.shift());
    }
  }

  function handleEvent(event) {
    const now = Date.now();

    if (event.type === "move") {
      // Переход между каналами: не логируем и не создаём новое сообщение.
      // Но если есть живое сообщение — обновляем в нём сводку «сейчас в каналах»
      // (перешедший появится в другом канале). Нет сообщения — move ничего не делает.
      if (session && now - session.lastEventAt <= config.voiceSessionIdleMs) {
        session.lastEventAt = now;
        requestFlush();
      }
      return;
    }

    // Новое сообщение создаём, только если пауза прошла И нас уже перебили в чате.
    // Пока наше сообщение остаётся последним — продолжаем редактировать его.
    if (
      session &&
      now - session.lastEventAt > config.voiceSessionIdleMs &&
      session.interrupted
    ) {
      session = null;
    }
    if (!session) {
      session = {
        messageId: null,
        visits: [],
        lastEventAt: now,
        interrupted: false,
      };
    }

    const isJoin = event.type === "join";

    let v = currentVisit(event.memberId, now);
    if (!v) {
      v = {
        memberId: event.memberId,
        memberName: event.memberName,
        joinAt: null,
        leaveAt: null,
        lastEventAt: now,
      };
      session.visits.push(v);
    }

    if (isJoin) {
      if (v.leaveAt != null && v.joinAt != null && v.leaveAt > v.joinAt) {
        v.leaveAt = null;
      } else if (v.joinAt == null) {
        v.joinAt = now;
      }
    } else {
      if (v.joinAt != null && v.leaveAt != null && v.joinAt > v.leaveAt) {
        v.joinAt = null;
        v.leaveAt = now;
      } else if (v.leaveAt == null) {
        v.leaveAt = now;
      }
    }
    v.memberName = event.memberName;
    v.lastEventAt = now;

    session.lastEventAt = now;
    trim();
    requestFlush();
  }

  function requestFlush() {
    if (flushPending) return;
    flushPending = true;

    const wait = Math.max(
      0,
      config.voiceMinEditIntervalMs - (Date.now() - lastFlushAt),
    );

    setTimeout(() => {
      flushPending = false;
      queue = queue
        .then(async () => {
          await flush();
          lastFlushAt = Date.now();
        })
        .catch((error) => console.error("voice-notify flush:", error));
    }, wait);
  }

  async function flush() {
    const text = renderSessionMessage({
      visits: session.visits,
      channels: discord.getVoiceChannels(),
      inviteUrl: await discord.getInviteUrl(),
      people,
    });

    if (session.messageId == null) {
      const message = await telegram.sendMessage(text, HTML_OPTS);
      session.messageId = message ? message.message_id : null;
    } else {
      await telegram.editMessage(session.messageId, text, HTML_OPTS);
    }
  }

  discord.emitter.on("voiceEvent", handleEvent);

  // Любое чужое сообщение в нашем чате после нашей сводки — значит нас «перебили».
  telegram.emitter.on("message", (ctx) => {
    if (String(ctx.chat.id) !== String(config.telegramChatId)) return;
    if (!session || session.messageId == null) return;
    if (ctx.message.message_id > session.messageId) {
      session.interrupted = true;
    }
  });

  telegram.emitter.on("command", (command) => {
    if (command === "/status") {
      telegram.sendMessage(
        renderVoiceStatus(discord.getVoiceChannels(), people),
        HTML_OPTS,
      );
    }
  });

  return { discord, people };
}
