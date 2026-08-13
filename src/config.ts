function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Не задана обязательная переменная окружения ${name}`);
  }
  return value;
}

export const config = {
  discordToken: required("DISCORD_TOKEN"),
  telegramBotToken: required("TELEGRAM_BOT_TOKEN"),
  telegramChatId: required("TELEGRAM_CHAT_ID"),
  voiceCollapseMs: Number(process.env.VOICE_COLLAPSE_MS) || 25000,
  voiceSessionIdleMs: Number(process.env.VOICE_SESSION_IDLE_MS) || 120000,
  voiceMaxLogLines: Number(process.env.VOICE_MAX_LOG_LINES) || 10,
  voiceMinEditIntervalMs: Number(process.env.VOICE_MIN_EDIT_INTERVAL_MS) || 2000,
  inviteMaxAgeSeconds: Number(process.env.INVITE_MAX_AGE_SECONDS) || 21600,
  telegramMode: (process.env.TELEGRAM_MODE || "polling") as "polling" | "webhook",
  telegramWebhookUrl: process.env.TELEGRAM_WEBHOOK_URL,
  telegramWebhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET,
  port: Number(process.env.PORT) || 8080,
  statsDbPath: process.env.STATS_DB_PATH || "./data/stats.db",
  // Смещение для нарезки суток в статистике. МСК = +3 (без перехода на летнее
  // время). Фиксированный сдвиг, чтобы не зависеть от TZ контейнера (в Docker — UTC).
  statsTzOffsetHours:
    process.env.STATS_TZ_OFFSET_HOURS != null
      ? Number(process.env.STATS_TZ_OFFSET_HOURS)
      : 3,
};

export type Config = typeof config;
