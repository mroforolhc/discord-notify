import "dotenv/config";
import { config } from "./config.js";
import { startDiscordBot } from "./discord.js";
import { startTelegramBot } from "./telegram.js";

const discordBot = await startDiscordBot(
  config.discordToken,
  config.voiceDebounceMs,
  config.inviteMaxAgeSeconds,
);

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

discordBot.emitter.on("voiceEvent", (message) => {
  telegramBot.sendMessage(message);
});

telegramBot.emitter.on("command", (command) => {
  if (command === "/status") {
    telegramBot.sendMessage(discordBot.getVoiceStatus());
  }
});
