import { startDiscordBot } from "../../integrations/discord.js";
import { createLlm } from "../../integrations/llm.js";
import {
  escapeHtml,
  renderChannelSegment,
  renderMoveSegment,
  renderWindow,
  renderVoiceStatus,
} from "./messages.js";

const HTML_OPTS = {
  parse_mode: "HTML",
  link_preview_options: { is_disabled: true },
};

// Инструкция для LLM: превратить сухие данные в одно живое сообщение.
const LLM_SYSTEM = `Ты — бот, который сообщает в Telegram-чат о движении в голосовых каналах Discord.
Тебе дают: что произошло за последние секунды и кто сейчас сидит в каналах.
Составь ОДНО короткое живое сообщение на русском о том, что случилось.

Правила:
- Только простой текст: без markdown, без HTML, без ссылок.
- Ники пиши как есть, не переводи их.
- Упоминай, кто зашёл/вышел/перешёл и с кем оказался рядом.
- Если кто-то скачет туда-сюда — скажи об этом коротко («поскакал», «мечется»).
- Не выдумывай людей и события, которых нет в данных.
- Коротко: 1–3 строки, без воды и вступлений вроде «Итак» или «Вот что произошло».

Ориентируйся на стиль примеров:
- Марков зашёл в «Голос», сидит один
- Марков зашёл к sleroq, Селя и sakameow
- 1, 2 и 3 зашли к 4 и 5
- Саня и Петя вышли из «Голос»
- Марков заглянул к A и B и вышел
- Марков зашёл и вышел 3 раза
- Пётр перешёл из «AFK» к Саше и Маше
- Марков мечется по каналам, остановился в «Игры»`;

export async function registerVoiceNotify({ telegram, config }) {
  const discord = await startDiscordBot(
    config.discordToken,
    config.inviteMaxAgeSeconds,
  );
  const llm = createLlm({
    apiKey: config.llmApiKey,
    baseUrl: config.llmBaseUrl,
    model: config.llmModel,
  });

  // Окно активности: пока события идут с промежутком ≤ voiceBurstWindowMs,
  // копим их в одно сообщение и правим его вживую (текст каждый раз от LLM).
  // window = { messageId, channels, moves, lastEventAt, flushPending, lastFlushAt }
  let win = null;
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

  // Троттлинг правок: не чаще одной за voiceMinEditIntervalMs. Первая
  // отправка мгновенная (lastFlushAt в прошлом), дальше события коалесцируются.
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

  async function flush(burst) {
    const live = discord.getVoiceChannels();
    const inviteUrl = await discord.getInviteUrl();

    // Текст от LLM; при любой осечке — детерминированный рендер.
    const llmText = await llm.complete(LLM_SYSTEM, describeForLlm(burst, live));
    const text = llmText
      ? renderWindow({ segments: [escapeHtml(llmText)], inviteUrl })
      : renderWindow({ segments: buildSegments(burst, live), inviteUrl });

    if (burst.messageId == null) {
      const message = await telegram.sendMessage(text, HTML_OPTS);
      burst.messageId = message ? message.message_id : null;
    } else {
      await telegram.editMessage(burst.messageId, text, HTML_OPTS);
    }
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

  // Детерминированные сегменты сообщения (фолбэк, если LLM недоступен).
  function buildSegments(burst, live) {
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
    return segments;
  }

  // Сухое описание окна + текущего состояния — вход для LLM.
  function describeForLlm(burst, live) {
    const lines = ["Что произошло только что:"];

    for (const channel of burst.channels.values()) {
      const { joiners, leavers, bouncers } = classifyActors(channel.actors);
      const parts = [];
      if (joiners.length) parts.push(`зашли: ${joiners.join(", ")}`);
      if (leavers.length) parts.push(`вышли: ${leavers.join(", ")}`);
      for (const b of bouncers) {
        parts.push(
          `${b.name} заходил-выходил ${b.leaves} раз (${b.netIn ? "сейчас в канале" : "в итоге вышел"})`,
        );
      }
      lines.push(`- Канал «${channel.channelName}»: ${parts.join("; ")}`);
    }

    for (const move of burst.moves.values()) {
      const churn = move.moveCount > 1 ? ` (метался, ${move.moveCount} переходов)` : "";
      lines.push(
        `- ${move.name} перешёл из «${move.fromChannelName}» в «${move.toChannelName}»${churn}`,
      );
    }

    lines.push("", "Кто сейчас в голосовых каналах:");
    if (live.length === 0) {
      lines.push("- никого нет");
    } else {
      for (const c of live) {
        lines.push(`- «${c.channelName}»: ${c.members.map((m) => m.name).join(", ")}`);
      }
    }

    return lines.join("\n");
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
