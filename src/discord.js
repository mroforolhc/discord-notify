import { Client, GatewayIntentBits } from "discord.js";
import { EventEmitter } from "node:events";

export async function startDiscordBot(
  token,
  debounceMs = 15000,
  inviteMaxAgeSeconds = 21600,
) {
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

  async function ensureInviteLink(channel) {
    const cached = inviteLinks.get(channel.id);
    if (cached && (cached.expiresAt === null || cached.expiresAt > Date.now())) {
      return cached.url;
    }

    if (
      !channel.permissionsFor(channel.guild.members.me)?.has("CreateInstantInvite")
    ) {
      return null;
    }

    try {
      const invite = await channel.createInvite({
        maxAge: inviteMaxAgeSeconds,
        unique: false,
      });
      inviteLinks.set(channel.id, {
        url: invite.url,
        expiresAt:
          inviteMaxAgeSeconds > 0
            ? Date.now() + inviteMaxAgeSeconds * 1000
            : null,
      });
      return invite.url;
    } catch (error) {
      console.error("Discord: не удалось создать инвайт:", error);
      return null;
    }
  }

  function describeTransition(member, beforeChannel, afterChannel, inviteUrl) {
    if (!beforeChannel && afterChannel) {
      const invitePart = inviteUrl ? `\n\n${inviteUrl} (мяу мяу мяу)` : "";
      return `${member.displayName} зашёл в ${afterChannel.name}${invitePart}`;
    } else if (beforeChannel && !afterChannel) {
      return `${member.displayName} вышел из ${beforeChannel.name}`;
    }
    return null;
  }

  client.once("clientReady", () => {
    console.log(`Discord: Бот запущен как ${client.user.tag}`);
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
        ? await ensureInviteLink(afterChannel)
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
