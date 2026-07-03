import { Client, GatewayIntentBits } from "discord.js";
import { EventEmitter } from "node:events";

export async function startDiscordBot(token) {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildMembers,
    ],
  });

  const emitter = new EventEmitter();
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

  client.once("clientReady", async () => {
    console.log(`Discord: Бот запущен как ${client.user.tag}`);
    for (const guild of client.guilds.cache.values()) {
      await ensureInviteLink(guild);
    }
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
        inviteUrl: await ensureInviteLink(member.guild),
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
