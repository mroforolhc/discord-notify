import { Client, GatewayIntentBits } from "discord.js";
import { EventEmitter } from "node:events";

export async function startDiscordBot(token, inviteMaxAgeSeconds = 21600) {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildMembers,
    ],
  });

  const emitter = new EventEmitter();
  let cachedInvite = null; // { url, expiresAt }

  async function getInviteUrl() {
    if (cachedInvite && cachedInvite.expiresAt > Date.now()) {
      return cachedInvite.url;
    }

    const channel = pickInviteChannel();
    if (!channel) return null;

    try {
      const invite = await channel.createInvite({
        maxAge: inviteMaxAgeSeconds,
        unique: false,
      });
      cachedInvite = {
        url: invite.url,
        expiresAt:
          inviteMaxAgeSeconds > 0
            ? Date.now() + inviteMaxAgeSeconds * 1000
            : Infinity,
      };
      return cachedInvite.url;
    } catch (error) {
      console.error("Discord: не удалось создать инвайт:", error);
      return null;
    }
  }

  function pickInviteChannel() {
    for (const guild of client.guilds.cache.values()) {
      const channels = [...guild.channels.cache.values()]
        .filter(
          (c) =>
            c.isVoiceBased() &&
            c
              .permissionsFor(guild.members.me)
              ?.has("CreateInstantInvite"),
        )
        .sort((a, b) => (a.id < b.id ? -1 : 1));
      if (channels.length > 0) return channels[0];
    }
    return null;
  }

  client.once("clientReady", () => {
    console.log(`Discord: Бот запущен как ${client.user.tag}`);
  });

  function memberMeta(member) {
    return {
      memberId: member.id,
      memberName: member.displayName,
      username: member.user.username,
      avatarUrl: member.user.displayAvatarURL({ extension: "png", size: 128 }),
    };
  }

  client.on("voiceStateUpdate", (oldState, newState) => {
    const member = newState.member || oldState.member;
    const beforeChannel = oldState.channel;
    const afterChannel = newState.channel;

    if (!beforeChannel && afterChannel) {
      emitter.emit("voiceEvent", { type: "join", ...memberMeta(member) });
    } else if (beforeChannel && !afterChannel) {
      emitter.emit("voiceEvent", { type: "leave", ...memberMeta(member) });
    } else if (
      beforeChannel &&
      afterChannel &&
      beforeChannel.id !== afterChannel.id
    ) {
      // Переход между каналами (drag): join/leave не срабатывают, но сводка
      // «сейчас в каналах» изменилась. Совпадение id = мьют/глушение — игнорим.
      emitter.emit("voiceEvent", { type: "move", ...memberMeta(member) });
    }
  });

  function getVoiceChannels() {
    const result = [];
    for (const guild of client.guilds.cache.values()) {
      for (const channel of guild.channels.cache.values()) {
        if (channel.isVoiceBased() && channel.members.size > 0) {
          result.push({
            channelId: channel.id,
            channelName: channel.name,
            members: [...channel.members.values()].map((m) => ({
              id: m.id,
              displayName: m.displayName,
              username: m.user.username,
              avatarUrl: m.user.displayAvatarURL({
                extension: "png",
                size: 128,
              }),
            })),
          });
        }
      }
    }

    return result;
  }

  await client.login(token);

  return { emitter, getVoiceChannels, getInviteUrl };
}
