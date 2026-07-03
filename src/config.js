export const config = {
  discordToken: process.env.DISCORD_TOKEN,
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
  telegramChatId: process.env.TELEGRAM_CHAT_ID,
  voiceEditWindowMs: Number(process.env.VOICE_EDIT_WINDOW_MS) || 120000,
  inviteMaxAgeSeconds: Number(process.env.INVITE_MAX_AGE_SECONDS) || 21600,
  telegramMode: process.env.TELEGRAM_MODE || "polling",
  telegramWebhookUrl: process.env.TELEGRAM_WEBHOOK_URL,
  telegramWebhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET,
  port: Number(process.env.PORT) || 8080,
};
