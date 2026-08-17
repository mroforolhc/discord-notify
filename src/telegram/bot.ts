import { Bot, webhookCallback } from "grammy";
import type { Context, Filter } from "grammy";
import { autoRetry } from "@grammyjs/auto-retry";
import { EventEmitter } from "node:events";
import express from "express";
import type { Server } from "node:http";

export type MessageContext = Filter<Context, "message">;
export type CallbackContext = Filter<Context, "callback_query:data">;

interface TelegramEvents {
  message: [ctx: MessageContext];
  command: [command: string, ctx: MessageContext];
  callback: [data: string, ctx: CallbackContext];
}

export interface TelegramEmitter extends EventEmitter {
  on<K extends keyof TelegramEvents>(
    event: K,
    listener: (...args: TelegramEvents[K]) => void,
  ): this;
  emit<K extends keyof TelegramEvents>(
    event: K,
    ...args: TelegramEvents[K]
  ): boolean;
}

export interface TelegramBotOptions {
  mode?: "polling" | "webhook";
  webhookUrl?: string;
  webhookSecret?: string;
  port?: number;
}

export interface TelegramBot {
  emitter: TelegramEmitter;
  sendMessage: (
    text: string,
    extra?: Record<string, unknown>,
  ) => Promise<{ message_id: number } | null>;
  editMessage: (
    messageId: number,
    text: string,
    extra?: Record<string, unknown>,
  ) => Promise<unknown>;
  sendPhoto: (
    photo: string,
    extra?: Record<string, unknown>,
  ) => Promise<{ message_id: number } | null>;
  editMessageCaption: (
    messageId: number,
    caption: string,
    extra?: Record<string, unknown>,
  ) => Promise<unknown>;
  answerCallback: (
    callbackQueryId: string,
    text?: string,
    showAlert?: boolean,
  ) => Promise<unknown>;
  deleteMessage: (
    chat: number | string,
    messageId: number,
  ) => Promise<unknown>;
  // Варианты с явным адресатом — чтобы отвечать в тот чат, откуда написали.
  sendMessageTo: (
    chat: number | string,
    text: string,
    extra?: Record<string, unknown>,
  ) => Promise<{ message_id: number } | null>;
  sendPhotoTo: (
    chat: number | string,
    photo: string,
    extra?: Record<string, unknown>,
  ) => Promise<{ message_id: number } | null>;
  editMessageCaptionTo: (
    chat: number | string,
    messageId: number,
    caption: string,
    extra?: Record<string, unknown>,
  ) => Promise<unknown>;
  stop: () => Promise<void>;
}

export async function startTelegramBot(
  botToken: string,
  chatId: string,
  options: TelegramBotOptions = {},
): Promise<TelegramBot> {
  const { mode = "polling", webhookUrl, webhookSecret, port = 8080 } = options;

  const bot = new Bot(botToken);
  bot.api.config.use(autoRetry());
  const emitter: TelegramEmitter = new EventEmitter();

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

  let server: Server | undefined;

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

    server = await new Promise<Server>((resolve) => {
      const s = app.listen(port, () => resolve(s));
    });

    await bot.api.setWebhook(webhookUrl, { secret_token: webhookSecret });
    console.log(`Telegram: Бот запущен, режим webhook, порт ${port}`);
  } else {
    await bot.api.deleteWebhook();
    bot.start();
    console.log(`Telegram: Бот запущен, режим polling`);
  }

  async function sendMessageTo(
    chat: number | string,
    text: string,
    extra: Record<string, unknown> = {},
  ) {
    try {
      return await bot.api.sendMessage(
        chat,
        text,
        extra as Parameters<typeof bot.api.sendMessage>[2],
      );
    } catch (error) {
      console.error("Ошибка отправки в Telegram:", error);
      return null;
    }
  }

  function sendMessage(text: string, extra: Record<string, unknown> = {}) {
    return sendMessageTo(chatId, text, extra);
  }

  async function editMessage(
    messageId: number,
    text: string,
    extra: Record<string, unknown> = {},
  ) {
    try {
      return await bot.api.editMessageText(
        chatId,
        messageId,
        text,
        extra as Parameters<typeof bot.api.editMessageText>[3],
      );
    } catch (error) {
      console.error("Ошибка редактирования сообщения в Telegram:", error);
      return null;
    }
  }

  async function sendPhotoTo(
    chat: number | string,
    photo: string,
    extra: Record<string, unknown> = {},
  ) {
    try {
      return await bot.api.sendPhoto(
        chat,
        photo,
        extra as Parameters<typeof bot.api.sendPhoto>[2],
      );
    } catch (error) {
      console.error("Ошибка отправки фото в Telegram:", error);
      return null;
    }
  }

  function sendPhoto(photo: string, extra: Record<string, unknown> = {}) {
    return sendPhotoTo(chatId, photo, extra);
  }

  async function editMessageCaptionTo(
    chat: number | string,
    messageId: number,
    caption: string,
    extra: Record<string, unknown> = {},
  ) {
    try {
      return await bot.api.editMessageCaption(chat, messageId, {
        caption,
        ...extra,
      } as Parameters<typeof bot.api.editMessageCaption>[2]);
    } catch (error) {
      console.error("Ошибка редактирования подписи в Telegram:", error);
      return null;
    }
  }

  function editMessageCaption(
    messageId: number,
    caption: string,
    extra: Record<string, unknown> = {},
  ) {
    return editMessageCaptionTo(chatId, messageId, caption, extra);
  }

  // Гасит «часики» на нажатой инлайн-кнопке; text — тост, showAlert — модалка.
  async function answerCallback(
    callbackQueryId: string,
    text?: string,
    showAlert = false,
  ) {
    try {
      return await bot.api.answerCallbackQuery(callbackQueryId, {
        text,
        show_alert: showAlert,
      });
    } catch (error) {
      console.error("Ошибка ответа на callback в Telegram:", error);
      return null;
    }
  }

  async function deleteMessage(chat: number | string, messageId: number) {
    try {
      return await bot.api.deleteMessage(chat, messageId);
    } catch (error) {
      console.error("Ошибка удаления сообщения в Telegram:", error);
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
    deleteMessage,
    sendMessageTo,
    sendPhotoTo,
    editMessageCaptionTo,
    stop,
  };
}
