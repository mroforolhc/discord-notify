import { startDiscordBot } from "../../integrations/discord.js";
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

  // Одна живая сессия-сводка: { messageId, visits: Visit[] }.
  // Visit = { memberId, memberName, joinAt, leaveAt, lastEventAt }.
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
    return (v.joinAt != null ? 1 : 0) + (v.leaveAt != null ? 1 : 0);
  }

  function trim() {
    let total = session.visits.reduce((s, v) => s + lineCount(v), 0);
    while (total > config.voiceMaxLogLines && session.visits.length > 1) {
      total -= lineCount(session.visits.shift());
    }
  }

  function handleEvent(event) {
    const now = Date.now();

    if (session && now - session.lastEventAt > config.voiceSessionIdleMs) {
      session = null;
    }
    if (!session) {
      session = { messageId: null, visits: [], lastEventAt: now };
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
      v.leaveAt = null;
      if (v.joinAt == null) v.joinAt = now;
    } else {
      v.leaveAt = now;
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
      timezone: config.voiceTimezone,
      edited: session.messageId != null,
      updatedAt: Date.now(),
    });

    if (session.messageId == null) {
      const message = await telegram.sendMessage(text, HTML_OPTS);
      session.messageId = message ? message.message_id : null;
    } else {
      await telegram.editMessage(session.messageId, text, HTML_OPTS);
    }
  }

  discord.emitter.on("voiceEvent", handleEvent);

  telegram.emitter.on("command", (command) => {
    if (command === "/status") {
      telegram.sendMessage(
        renderVoiceStatus(discord.getVoiceChannels()),
        HTML_OPTS,
      );
    }
  });
}
