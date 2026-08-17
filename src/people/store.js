import { readFileSync, watch } from "node:fs";
import { resolve } from "node:path";

// Нормализуем пол к "m"/"f" — терпимо к тому, как его впишут руками в JSON.
function normalizeGender(raw) {
  const g = String(raw ?? "").trim().toLowerCase();
  if (["m", "м", "male", "муж", "мужской"].includes(g)) return "m";
  if (["f", "ж", "female", "жен", "женский"].includes(g)) return "f";
  return undefined;
}

export function createPeopleStore(filePath) {
  const path = resolve(process.cwd(), filePath);
  let people = new Map();

  function reload() {
    let raw;
    try {
      raw = readFileSync(path, "utf8");
    } catch {
      people = new Map();
      return; // файла нет — просто пустая мапа
    }

    try {
      const parsed = JSON.parse(raw);
      const next = new Map();
      for (const [id, entry] of Object.entries(parsed)) {
        if (!entry || typeof entry !== "object") continue;
        next.set(String(id), {
          name: entry.name != null ? String(entry.name) : undefined,
          gender: normalizeGender(entry.gender),
        });
      }
      people = next;
    } catch (error) {
      console.warn(`people: не удалось разобрать ${path}:`, error.message);
      // Оставляем прежнюю мапу, чтобы битая правка не обнуляла данные.
    }
  }

  reload();

  // Дебаунсим: редакторы часто дёргают файл несколько раз за сохранение.
  let debounce = null;
  try {
    watch(path, () => {
      clearTimeout(debounce);
      debounce = setTimeout(reload, 200);
    });
  } catch {
    // watch не поддержан (напр. bind-mount) — спасает рестарт.
  }

  return {
    get: (id) => people.get(String(id)),
    reload,
  };
}
