import { readFileSync, writeFileSync, renameSync, watch } from "node:fs";
import { resolve, dirname, basename } from "node:path";

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
  let selfWriteAt = 0; // метка своей записи — чтобы не ловить свой же fs.watch

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

  function persist() {
    const obj = {};
    for (const [id, { name, gender }] of people) {
      const entry = {};
      if (name != null) entry.name = name;
      if (gender != null) entry.gender = gender;
      obj[id] = entry;
    }
    const tmp = resolve(dirname(path), `.${basename(path)}.tmp`);
    selfWriteAt = Date.now();
    writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`);
    renameSync(tmp, path); // атомарная замена
  }

  // Частичный апдейт: patch = { name?, gender? }. gender: undefined снимает пол.
  // Пустая запись (нет ни имени, ни пола) удаляется, чтобы файл не мусорился.
  function set(id, patch) {
    const key = String(id);
    const prev = people.get(key) ?? { name: undefined, gender: undefined };
    const next = {
      name: "name" in patch ? patch.name || undefined : prev.name,
      gender:
        "gender" in patch ? normalizeGender(patch.gender) : prev.gender,
    };
    if (next.name == null && next.gender == null) people.delete(key);
    else people.set(key, next);
    persist();
    return people.get(key);
  }

  function remove(id) {
    people.delete(String(id));
    persist();
  }

  reload();

  // Дебаунсим: редакторы часто дёргают файл несколько раз за сохранение.
  let debounce = null;
  try {
    watch(path, () => {
      if (Date.now() - selfWriteAt < 1000) return; // это была наша запись
      clearTimeout(debounce);
      debounce = setTimeout(reload, 200);
    }).unref();
  } catch {
    // watch не поддержан (напр. bind-mount) — спасает рестарт.
  }

  return {
    get: (id) => people.get(String(id)),
    set,
    remove,
    reload,
  };
}
