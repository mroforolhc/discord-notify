import { Bot, webhookCallback } from "grammy";
import { autoRetry } from "@grammyjs/auto-retry";
import { EventEmitter } from "node:events";
import express from "express";

export async function startTelegramBot(botToken, chatId, options = {}) {
  const { mode = "polling", webhookUrl, webhookSecret, port = 8080 } = options;

  const bot = new Bot(botToken);
  bot.api.config.use(autoRetry());
  const emitter = new EventEmitter();

  bot.on("message", (ctx) => {
    emitter.emit("message", ctx);

    const text = ctx.message.text;
    if (!text || !text.startsWith("/")) return;

    const command = text.split(" ")[0].split("@")[0];
    emitter.emit("command", command, ctx);
  });

  bot.on("callback_query:data", (ctx) => {
    emitter.emit("callback", ctx.callbackQuery.data, ctx);
  });

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

  async function sendMessage(text, extra = {}) {
    try {
      return await bot.api.sendMessage(chatId, text, extra);
    } catch (error) {
      console.error("Ошибка отправки в Telegram:", error);
      return null;
    }
  }

  async function editMessage(messageId, text, extra = {}) {
    try {
      return await bot.api.editMessageText(chatId, messageId, text, extra);
    } catch (error) {
      console.error("Ошибка редактирования сообщения в Telegram:", error);
      return null;
    }
  }

  async function sendPhoto(photo, extra = {}) {
    try {
      return await bot.api.sendPhoto(chatId, photo, extra);
    } catch (error) {
      console.error("Ошибка отправки фото в Telegram:", error);
      return null;
    }
  }

  async function editMessageCaption(messageId, caption, extra = {}) {
    try {
      return await bot.api.editMessageCaption(chatId, messageId, {
        caption,
        ...extra,
      });
    } catch (error) {
      console.error("Ошибка редактирования подписи в Telegram:", error);
      return null;
    }
  }

  // Гасит «часики» на нажатой инлайн-кнопке; text — опциональный тост.
  async function answerCallback(callbackQueryId, text) {
    try {
      return await bot.api.answerCallbackQuery(callbackQueryId, { text });
    } catch (error) {
      console.error("Ошибка ответа на callback в Telegram:", error);
      return null;
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

  return {
    emitter,
    sendMessage,
    editMessage,
    sendPhoto,
    editMessageCaption,
    answerCallback,
    stop,
  };
}
