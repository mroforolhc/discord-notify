import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/features/chat-stats/schema.ts",
  out: "./drizzle",
});
