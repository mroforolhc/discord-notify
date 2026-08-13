import { Bot, webhookCallback } from "grammy";
import type { Context, Filter } from "grammy";
import { autoRetry } from "@grammyjs/auto-retry";
import { EventEmitter } from "node:events";
import express from "express";
import type { Server } from "node:http";

export type MessageContext = Filter<Context, "message">;

interface TelegramEvents {
  message: [ctx: MessageContext];
  command: [command: string, ctx: MessageContext];
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

  async function sendMessage(text: string, extra: Record<string, unknown> = {}) {
    try {
      return await bot.api.sendMessage(
        chatId,
        text,
        extra as Parameters<typeof bot.api.sendMessage>[2],
      );
    } catch (error) {
      console.error("Ошибка отправки в Telegram:", error);
      return null;
    }
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

  async function stop() {
    if (server) {
      await bot.api.deleteWebhook();
      server.close();
    } else {
      await bot.stop();
    }
  }

  return { emitter, sendMessage, editMessage, stop };
}
