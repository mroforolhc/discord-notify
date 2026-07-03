import { Bot, webhookCallback } from "grammy";
import { EventEmitter } from "node:events";
import express from "express";

export async function startTelegramBot(botToken, chatId, options = {}) {
  const { mode = "polling", webhookUrl, webhookSecret, port = 8080 } = options;

  const bot = new Bot(botToken);
  const emitter = new EventEmitter();

  bot.on("message:text").filter(
    (ctx) =>
      ctx.message.text.startsWith("/") &&
      String(ctx.chat.id) === String(chatId),
    (ctx) => {
      emitter.emit("command", ctx.message.text.split(" ")[0], ctx);
    },
  );

  bot.catch(({ error }) => {
    console.error("Ошибка Telegram-бота:", error);
  });

  let server;

  if (mode === "webhook") {
    if (!webhookUrl) {
      throw new Error("TELEGRAM_WEBHOOK_URL обязателен в режиме webhook");
    }

    const path = new URL(webhookUrl).pathname;
    const app = express();
    app.use(express.json());
    app.post(
      path,
      webhookCallback(bot, "express", { secretToken: webhookSecret }),
    );

    server = await new Promise((resolve) => {
      const s = app.listen(port, () => resolve(s));
    });

    await bot.api.setWebhook(webhookUrl, { secret_token: webhookSecret });
    console.log(`Telegram: Бот запущен, режим webhook, порт ${port}`);
  } else {
    await bot.api.deleteWebhook();
    bot.start();
    console.log(`Telegram: Бот запущен, режим polling`);
  }

  async function sendMessage(text) {
    try {
      await bot.api.sendMessage(chatId, text);
    } catch (error) {
      console.error("Ошибка отправки в Telegram:", error);
    }
  }

  async function stop() {
    if (server) {
      await bot.api.deleteWebhook();
      server.close();
    } else {
      await bot.stop();
    }
  }

  return { emitter, sendMessage, stop };
}
