import { startDiscordBot } from "../../integrations/discord.js";
import {
  renderChannelBurst,
  renderMove,
  renderVoiceStatus,
} from "./messages.js";

const HTML_OPTS = {
  parse_mode: "HTML",
  link_preview_options: { is_disabled: true },
};

export async function registerVoiceNotify({ telegram, config }) {
  const discord = await startDiscordBot(
    config.discordToken,
    config.inviteMaxAgeSeconds,
  );

  // Бёрсты заходов/выходов — на канал; бёрсты переходов — на пользователя.
  // Оба живут в окне voiceBurstWindowMs и редактируют одно сообщение.
  const channelBursts = new Map(); // channelId -> { kind: "channel", ... }
  const moveBursts = new Map(); //    userId    -> { kind: "move", ... }

  // Сериализация фактических вызовов Telegram (по всем бёрстам).
  let queue = Promise.resolve();

  function handleEvent(event) {
    if (event.type === "move") handleMove(event);
    else handleJoinLeave(event);
  }

  function handleJoinLeave(event) {
    const now = Date.now();

    let burst = channelBursts.get(event.channelId);
    if (!burst || now - burst.lastEventAt > config.voiceBurstWindowMs) {
      burst = {
        kind: "channel",
        channelId: event.channelId,
        channelName: event.channelName,
        messageId: null,
        actors: new Map(),
        lastEventAt: now,
        flushPending: false,
        lastFlushAt: 0,
      };
      channelBursts.set(event.channelId, burst);
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

  function handleMove(event) {
    const now = Date.now();

    let burst = moveBursts.get(event.memberId);
    if (!burst || now - burst.lastEventAt > config.voiceBurstWindowMs) {
      burst = {
        kind: "move",
        memberId: event.memberId,
        name: event.memberName,
        messageId: null,
        moveCount: 0,
        // канал, из которого начался первый переход в этом бёрсте
        fromChannelId: event.fromChannelId,
        fromChannelName: event.fromChannelName,
        toChannelId: event.toChannelId,
        toChannelName: event.toChannelName,
        lastEventAt: now,
        flushPending: false,
        lastFlushAt: 0,
      };
      moveBursts.set(event.memberId, burst);
    }

    burst.moveCount += 1;
    burst.name = event.memberName;
    burst.toChannelId = event.toChannelId;
    burst.toChannelName = event.toChannelName;
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

  async function flush(burst) {
    const inviteUrl = await discord.getInviteUrl();
    const text =
      burst.kind === "move"
        ? moveText(burst, inviteUrl)
        : channelText(burst, inviteUrl);

    if (burst.messageId == null) {
      const message = await telegram.sendMessage(text, HTML_OPTS);
      burst.messageId = message ? message.message_id : null;
    } else {
      await telegram.editMessage(burst.messageId, text, HTML_OPTS);
    }
  }

  // Имена участников канала (из живого состояния), кроме исключённых id.
  function membersOf(channelId, excludeIds) {
    const channel = discord
      .getVoiceChannels()
      .find((c) => c.channelId === channelId);
    if (!channel) return [];
    return channel.members
      .filter((m) => !excludeIds.has(m.id))
      .map((m) => m.name);
  }

  function channelText(burst, inviteUrl) {
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
    const others = membersOf(burst.channelId, new Set(burst.actors.keys()));
    return renderChannelBurst({
      channelName: burst.channelName,
      joiners,
      leavers,
      bouncers,
      others,
      inviteUrl,
    });
  }

  function moveText(burst, inviteUrl) {
    const self = new Set([burst.memberId]);
    return renderMove({
      name: burst.name,
      moveCount: burst.moveCount,
      fromChannelName: burst.fromChannelName,
      fromRemain: membersOf(burst.fromChannelId, self),
      toChannelName: burst.toChannelName,
      others: membersOf(burst.toChannelId, self),
      inviteUrl,
    });
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
