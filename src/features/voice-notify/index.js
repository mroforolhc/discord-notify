import { startDiscordBot } from "../../integrations/discord.js";
import {
  renderChannelSegment,
  renderMoveSegment,
  renderWindow,
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

  // Одно «окно активности»: пока события идут с промежутком ≤ voiceBurstWindowMs,
  // копим их все (любые каналы/люди) в одно редактируемое сообщение.
  // window = { messageId, channels: Map<channelId,{channelName,actors}>,
  //            moves: Map<userId,{...}>, lastEventAt, flushPending, lastFlushAt }
  let win = null;

  // Сериализация фактических вызовов Telegram.
  let queue = Promise.resolve();

  function handleEvent(event) {
    const now = Date.now();

    if (win && now - win.lastEventAt > config.voiceBurstWindowMs) win = null;
    if (!win) {
      win = {
        messageId: null,
        channels: new Map(),
        moves: new Map(),
        lastEventAt: now,
        flushPending: false,
        lastFlushAt: 0,
      };
    }

    if (event.type === "move") addMove(event);
    else addJoinLeave(event);

    win.lastEventAt = now;
    requestFlush();
  }

  function addJoinLeave(event) {
    let channel = win.channels.get(event.channelId);
    if (!channel) {
      channel = { channelName: event.channelName, actors: new Map() };
      win.channels.set(event.channelId, channel);
    }
    channel.channelName = event.channelName;

    const actor = channel.actors.get(event.memberId) ?? {
      name: event.memberName,
      joins: 0,
      leaves: 0,
    };
    if (event.type === "join") actor.joins += 1;
    else actor.leaves += 1;
    actor.name = event.memberName;
    channel.actors.set(event.memberId, actor);
  }

  function addMove(event) {
    let move = win.moves.get(event.memberId);
    if (!move) {
      move = {
        name: event.memberName,
        moveCount: 0,
        fromChannelId: event.fromChannelId,
        fromChannelName: event.fromChannelName,
        toChannelId: event.toChannelId,
        toChannelName: event.toChannelName,
      };
      win.moves.set(event.memberId, move);
    }
    move.moveCount += 1;
    move.name = event.memberName;
    move.toChannelId = event.toChannelId;
    move.toChannelName = event.toChannelName;
  }

  function requestFlush() {
    if (win.flushPending) return;
    win.flushPending = true;

    const target = win; // фиксируем окно на момент планирования
    const wait = Math.max(
      0,
      config.voiceMinEditIntervalMs - (Date.now() - target.lastFlushAt),
    );

    setTimeout(() => {
      target.flushPending = false;
      queue = queue
        .then(async () => {
          await flush(target);
          target.lastFlushAt = Date.now();
        })
        .catch((error) => console.error("voice-notify flush:", error));
    }, wait);
  }

  // Имена участников канала (из живого состояния), кроме исключённых id.
  function membersOf(liveChannels, channelId, excludeIds) {
    const channel = liveChannels.find((c) => c.channelId === channelId);
    if (!channel) return [];
    return channel.members
      .filter((m) => !excludeIds.has(m.id))
      .map((m) => m.name);
  }

  // Раскладывает актёров канала на зашедших / вышедших / «поскакавших».
  function classifyActors(actors) {
    const joiners = [];
    const leavers = [];
    const bouncers = [];
    for (const actor of actors.values()) {
      if (actor.leaves === 0) joiners.push(actor.name);
      else if (actor.joins === 0) leavers.push(actor.name);
      else
        bouncers.push({
          name: actor.name,
          leaves: actor.leaves,
          netIn: actor.joins > actor.leaves,
        });
    }
    return { joiners, leavers, bouncers };
  }

  async function flush(burst) {
    const inviteUrl = await discord.getInviteUrl();
    const live = discord.getVoiceChannels();
    const segments = [];

    for (const [channelId, channel] of burst.channels) {
      const { joiners, leavers, bouncers } = classifyActors(channel.actors);
      segments.push(
        renderChannelSegment({
          channelName: channel.channelName,
          joiners,
          leavers,
          bouncers,
          others: membersOf(live, channelId, new Set(channel.actors.keys())),
        }),
      );
    }

    for (const [userId, move] of burst.moves) {
      const self = new Set([userId]);
      segments.push(
        renderMoveSegment({
          name: move.name,
          moveCount: move.moveCount,
          fromChannelName: move.fromChannelName,
          fromRemain: membersOf(live, move.fromChannelId, self),
          toChannelName: move.toChannelName,
          others: membersOf(live, move.toChannelId, self),
        }),
      );
    }

    const text = renderWindow({ segments, inviteUrl });

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
