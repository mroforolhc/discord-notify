import { startDiscordBot } from "../../integrations/discord.js";
import { renderChannelBurst, renderVoiceStatus } from "./messages.js";

const HTML_OPTS = {
  parse_mode: "HTML",
  link_preview_options: { is_disabled: true },
};

export async function registerVoiceNotify({ telegram, config }) {
  const discord = await startDiscordBot(
    config.discordToken,
    config.inviteMaxAgeSeconds,
  );

  // Бёрст на канал: пока события по каналу идут с промежутком ≤ окна, копим
  // актёров в одно редактируемое сообщение.
  // Burst = { channelName, messageId, actors: Map<id,{name,joins,leaves}>,
  //           lastEventAt, flushPending, lastFlushAt }
  const bursts = new Map();

  // Сериализация фактических вызовов Telegram (по всем бёрстам).
  let queue = Promise.resolve();

  function handleEvent(event) {
    const now = Date.now();

    let burst = bursts.get(event.channelId);
    if (!burst || now - burst.lastEventAt > config.voiceBurstWindowMs) {
      burst = {
        channelId: event.channelId,
        channelName: event.channelName,
        messageId: null,
        actors: new Map(),
        lastEventAt: now,
        flushPending: false,
        lastFlushAt: 0,
      };
      bursts.set(event.channelId, burst);
    }

    burst.channelName = event.channelName;

    const actor = burst.actors.get(event.memberId) ?? {
      name: event.memberName,
      joins: 0,
      leaves: 0,
    };
    if (event.type === "join") actor.joins += 1;
    else actor.leaves += 1;
    actor.name = event.memberName;
    burst.actors.set(event.memberId, actor);

    burst.lastEventAt = now;
    requestFlush(burst);
  }

  function requestFlush(burst) {
    if (burst.flushPending) return;
    burst.flushPending = true;

    const wait = Math.max(
      0,
      config.voiceMinEditIntervalMs - (Date.now() - burst.lastFlushAt),
    );

    setTimeout(() => {
      burst.flushPending = false;
      queue = queue
        .then(async () => {
          await flush(burst);
          burst.lastFlushAt = Date.now();
        })
        .catch((error) => console.error("voice-notify flush:", error));
    }, wait);
  }

  // Классифицируем актёров и собираем «других» из живого состояния канала.
  function classify(burst) {
    const joiners = [];
    const leavers = [];
    const bouncers = [];
    for (const actor of burst.actors.values()) {
      if (actor.leaves === 0) joiners.push(actor.name);
      else if (actor.joins === 0) leavers.push(actor.name);
      else
        bouncers.push({
          name: actor.name,
          leaves: actor.leaves,
          netIn: actor.joins > actor.leaves,
        });
    }

    const channel = discord
      .getVoiceChannels()
      .find((c) => c.channelId === burst.channelId);
    const others = channel
      ? channel.members
          .filter((m) => !burst.actors.has(m.id))
          .map((m) => m.name)
      : [];

    return { joiners, leavers, bouncers, others };
  }

  async function flush(burst) {
    const { joiners, leavers, bouncers, others } = classify(burst);
    const text = renderChannelBurst({
      channelName: burst.channelName,
      joiners,
      leavers,
      bouncers,
      others,
      inviteUrl: await discord.getInviteUrl(),
    });

    if (burst.messageId == null) {
      const message = await telegram.sendMessage(text, HTML_OPTS);
      burst.messageId = message ? message.message_id : null;
    } else {
      await telegram.editMessage(burst.messageId, text, HTML_OPTS);
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
