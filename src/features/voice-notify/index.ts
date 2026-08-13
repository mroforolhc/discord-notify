import { startDiscordBot } from "../../integrations/discord.js";
import type { VoiceEvent } from "../../integrations/discord.js";
import { renderSessionMessage, renderVoiceStatus } from "./messages.js";
import type { Visit } from "./messages.js";
import type { TelegramBot } from "../../telegram/bot.js";
import type { Config } from "../../config.js";

const HTML_OPTS = {
  parse_mode: "HTML",
  link_preview_options: { is_disabled: true },
};

interface Session {
  messageId: number | null;
  visits: Visit[];
  lastEventAt: number;
  interrupted: boolean;
}

export async function registerVoiceNotify({
  telegram,
  config,
}: {
  telegram: TelegramBot;
  config: Config;
}): Promise<void> {
  const discord = await startDiscordBot(
    config.discordToken,
    config.inviteMaxAgeSeconds,
  );

  let session: Session | null = null;
  let queue = Promise.resolve();
  let flushPending = false;
  let lastFlushAt = 0;

  function currentVisit(s: Session, memberId: string, now: number): Visit | null {
    for (let i = s.visits.length - 1; i >= 0; i--) {
      const v = s.visits[i];
      if (v.memberId === memberId) {
        return now - v.lastEventAt <= config.voiceCollapseMs ? v : null;
      }
    }
    return null;
  }

  function lineCount(v: Visit): number {
    return v.joinAt != null || v.leaveAt != null ? 1 : 0;
  }

  function trim(s: Session): void {
    let total = s.visits.reduce((acc, v) => acc + lineCount(v), 0);
    while (total > config.voiceMaxLogLines && s.visits.length > 1) {
      total -= lineCount(s.visits.shift()!);
    }
  }

  function handleEvent(event: VoiceEvent): void {
    const now = Date.now();

    if (event.type === "move") {
      if (session && now - session.lastEventAt <= config.voiceSessionIdleMs) {
        session.lastEventAt = now;
        requestFlush();
      }

      return;
    }

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
    const s = session;

    const isJoin = event.type === "join";

    let v = currentVisit(s, event.memberId, now);
    if (!v) {
      v = {
        memberId: event.memberId,
        memberName: event.memberName,
        joinAt: null,
        leaveAt: null,
        lastEventAt: now,
      };
      s.visits.push(v);
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

    s.lastEventAt = now;
    trim(s);
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

  async function flush(): Promise<void> {
    if (!session) return;
    const s = session;

    const text = renderSessionMessage({
      visits: s.visits,
      channels: discord.getVoiceChannels(),
      inviteUrl: await discord.getInviteUrl(),
    });

    if (s.messageId == null) {
      const message = await telegram.sendMessage(text, HTML_OPTS);
      s.messageId = message ? message.message_id : null;
    } else {
      await telegram.editMessage(s.messageId, text, HTML_OPTS);
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
        renderVoiceStatus(discord.getVoiceChannels()),
        HTML_OPTS,
      );
    }
  });
}
