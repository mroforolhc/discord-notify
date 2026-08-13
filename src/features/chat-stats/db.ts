import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "./schema.js";

function findProjectRoot(startDir: string): string {
  let dir = startDir;
  while (!existsSync(join(dir, "package.json"))) {
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error("Не найден корень проекта (package.json)");
    }
    dir = parent;
  }
  return dir;
}

const projectRoot = findProjectRoot(dirname(fileURLToPath(import.meta.url)));
const migrationsFolder = join(projectRoot, "drizzle");

export function openDb(dbPath: string) {
  mkdirSync(dirname(dbPath), { recursive: true });

  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder });
  return db;
}

export type StatsDb = ReturnType<typeof openDb>;
