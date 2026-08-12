import { startDiscordBot } from "../../integrations/discord.js";
import {
  describeJoin,
  describeQuickLeave,
  describeLeave,
} from "./messages.js";

// Фича голосовых уведомлений: следит за войс-каналами Discord (внешний
// источник, который стартует сама фича) и шлёт события в Telegram-ядро.
export async function registerVoiceNotify({ telegram, config }) {
  const discord = await startDiscordBot(
    config.discordToken,
    config.inviteMaxAgeSeconds,
  );

  const voiceSessions = new Map();

  discord.emitter.on("voiceEvent", async (event) => {
    const existing = voiceSessions.get(event.memberId);
    const now = Date.now();

    if (event.type === "join") {
      const text = describeJoin(event);

      if (existing && now - existing.updatedAt <= config.voiceEditWindowMs) {
        const edited = await telegram.editMessage(existing.messageId, text);
        if (edited) {
          voiceSessions.set(event.memberId, {
            messageId: existing.messageId,
            updatedAt: now,
          });
          return;
        }
      }

      const message = await telegram.sendMessage(text);
      if (message) {
        voiceSessions.set(event.memberId, {
          messageId: message.message_id,
          updatedAt: now,
        });
      }

      return;
    }

    if (existing && now - existing.updatedAt <= config.voiceEditWindowMs) {
      const edited = await telegram.editMessage(
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
    telegram.sendMessage(describeLeave(event));
  });

  telegram.emitter.on("command", (command) => {
    if (command === "/status") {
      telegram.sendMessage(discord.getVoiceStatus());
    }
  });
}
