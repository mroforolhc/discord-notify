import { Client, GatewayIntentBits } from "discord.js";
import { EventEmitter } from "node:events";

export async function startDiscordBot(
  token,
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
  const inviteLinks = new Map();

  async function ensureInviteLink(channel) {
    const cached = inviteLinks.get(channel.id);
    if (cached && cached.expiresAt > Date.now()) {
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
        expiresAt: Date.now() + inviteMaxAgeSeconds * 1000,
      });
      return invite.url;
    } catch (error) {
      console.error("Discord: не удалось создать инвайт:", error);
      return null;
    }
  }

  client.once("clientReady", () => {
    console.log(`Discord: Бот запущен как ${client.user.tag}`);
  });

  client.on("voiceStateUpdate", async (oldState, newState) => {
    const member = newState.member || oldState.member;
    const beforeChannel = oldState.channel;
    const afterChannel = newState.channel;

    if (!beforeChannel && afterChannel) {
      emitter.emit("voiceEvent", {
        type: "join",
        memberId: member.id,
        memberName: member.displayName,
        channelId: afterChannel.id,
        channelName: afterChannel.name,
        inviteUrl: await ensureInviteLink(afterChannel),
      });
    } else if (beforeChannel && !afterChannel) {
      emitter.emit("voiceEvent", {
        type: "leave",
        memberId: member.id,
        memberName: member.displayName,
        channelId: beforeChannel.id,
        channelName: beforeChannel.name,
      });
    }
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
