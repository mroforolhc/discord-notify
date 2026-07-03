import { Client, GatewayIntentBits } from "discord.js";
import { EventEmitter } from "node:events";

export async function startDiscordBot(token, debounceMs = 15000) {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildMembers,
    ],
  });

  const emitter = new EventEmitter();
  const pending = new Map();
  const inviteLinks = new Map();

  async function ensureInviteLink(guild) {
    if (inviteLinks.has(guild.id)) return inviteLinks.get(guild.id);

    const channel = guild.channels.cache.find(
      (c) =>
        (c.isTextBased() || c.isVoiceBased()) &&
        c.permissionsFor(guild.members.me)?.has("CreateInstantInvite"),
    );

    if (!channel) return null;

    try {
      const invite = await channel.createInvite({ maxAge: 0, unique: false });
      inviteLinks.set(guild.id, invite.url);
      return invite.url;
    } catch (error) {
      console.error("Discord: не удалось создать инвайт:", error);
      return null;
    }
  }

  function describeTransition(member, beforeChannel, afterChannel, inviteUrl) {
    if (!beforeChannel && afterChannel) {
      const invitePart = inviteUrl ? `\n\n${inviteUrl}` : "";
      return `${member.displayName} зашёл в ${afterChannel.name}${invitePart}`;
    } else if (beforeChannel && !afterChannel) {
      return `${member.displayName} вышел из ${beforeChannel.name}`;
    }
    return null;
  }

  client.once("clientReady", async () => {
    console.log(`Discord: Бот запущен как ${client.user.tag}`);
    for (const guild of client.guilds.cache.values()) {
      await ensureInviteLink(guild);
    }
  });

  client.on("voiceStateUpdate", (oldState, newState) => {
    const member = newState.member || oldState.member;
    const existing = pending.get(member.id);

    const beforeChannel = existing ? existing.beforeChannel : oldState.channel;

    if (existing) clearTimeout(existing.timer);

    const timer = setTimeout(async () => {
      pending.delete(member.id);

      const afterChannel = member.voice.channel ?? null;
      const inviteUrl = afterChannel
        ? await ensureInviteLink(member.guild)
        : null;
      const message = describeTransition(
        member,
        beforeChannel,
        afterChannel,
        inviteUrl,
      );

      if (message) {
        emitter.emit("voiceEvent", message);
      }
    }, debounceMs);

    pending.set(member.id, { beforeChannel, timer });
  });

  function getVoiceStatus() {
    const lines = [];

    for (const guild of client.guilds.cache.values()) {
      for (const channel of guild.channels.cache.values()) {
        if (channel.isVoiceBased() && channel.members.size > 0) {
          const names = [...channel.members.values()]
            .map((m) => m.displayName)
            .join(", ");
          lines.push(`${channel.name}: ${names}`);
        }
      }
    }

    return lines.length > 0 ? lines.join("\n") : "Все голосовые каналы пусты";
  }

  await client.login(token);

  return { emitter, getVoiceStatus };
}
