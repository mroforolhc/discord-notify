import "dotenv/config";
import { config } from "./config.js";
import { startTelegramBot } from "./telegram/bot.js";
import { registerVoiceNotify } from "./features/voice-notify/index.js";

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

await registerVoiceNotify({ telegram, config });
