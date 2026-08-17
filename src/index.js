import "dotenv/config";
import { config } from "./config.js";
import { startTelegramBot } from "./telegram/bot.js";
import { registerVoiceNotify } from "./features/voice-notify/index.js";
import { registerNaming } from "./features/voice-notify/naming.js";

const telegram = await startTelegramBot(
  config.telegramBotToken,
  config.telegramChatId,
  {
    mode: config.telegramMode,
    webhookUrl: config.telegramWebhookUrl,
    webhookSecret: config.telegramWebhookSecret,
    port: config.port,
  },
);

const { discord, people } = await registerVoiceNotify({ telegram, config });

registerNaming({ telegram, discord, people, config });
