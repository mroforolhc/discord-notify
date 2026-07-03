import "dotenv/config";
import { config } from "./config.js";
import { startDiscordBot } from "./discord.js";
import { startTelegramBot } from "./telegram.js";

const discordBot = await startDiscordBot(config.discordToken);

const telegramBot = await startTelegramBot(
  config.telegramBotToken,
  config.telegramChatId,
  {
    mode: config.telegramMode,
    webhookUrl: config.telegramWebhookUrl,
    webhookSecret: config.telegramWebhookSecret,
    port: config.port,
  },
);

const voiceSessions = new Map();

function describeJoin(event) {
  const invitePart = event.inviteUrl ? `\n\n${event.inviteUrl} (мяу мяу мяу)` : "";
  return `${event.memberName} сейчас в ${event.channelName}${invitePart}`;
}

function describeQuickLeave(event) {
  return `${event.memberName} был в ${event.channelName}, но уже вышел`;
}

function describeLeave(event) {
  return `${event.memberName} вышел из ${event.channelName}`;
}

discordBot.emitter.on("voiceEvent", async (event) => {
  const existing = voiceSessions.get(event.memberId);
  const now = Date.now();

  if (event.type === "join") {
    const text = describeJoin(event);

    if (existing && now - existing.updatedAt <= config.voiceEditWindowMs) {
      const edited = await telegramBot.editMessage(existing.messageId, text);
      if (edited) {
        voiceSessions.set(event.memberId, {
          messageId: existing.messageId,
          updatedAt: now,
        });
        return;
      }
    }

    const message = await telegramBot.sendMessage(text);
    if (message) {
      voiceSessions.set(event.memberId, {
        messageId: message.message_id,
        updatedAt: now,
      });
    }

    return;
  }

  if (existing && now - existing.updatedAt <= config.voiceEditWindowMs) {
    const edited = await telegramBot.editMessage(
      existing.messageId,
      describeQuickLeave(event),
    );
    if (edited) {
      voiceSessions.set(event.memberId, {
        messageId: existing.messageId,
        updatedAt: now,
      });
      return;
    }
  }

  voiceSessions.delete(event.memberId);
  telegramBot.sendMessage(describeLeave(event));
});

telegramBot.emitter.on("command", (command) => {
  if (command === "/status") {
    telegramBot.sendMessage(discordBot.getVoiceStatus());
  }
});
