import { readFileSync, writeFileSync, renameSync, watch } from "node:fs";
import { resolve, dirname, basename } from "node:path";

export type Gender = "m" | "f";

export interface Person {
  name?: string;
  gender?: Gender;
}

export interface PeopleStore {
  get: (id: string) => Person | undefined;
  set: (
    id: string,
    patch: { name?: string; gender?: string | undefined },
  ) => Person | undefined;
  remove: (id: string) => void;
  reload: () => void;
}

// Нормализуем пол к "m"/"f" — терпимо к тому, как его впишут руками в JSON.
function normalizeGender(raw: unknown): Gender | undefined {
  const g = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (["m", "м", "male", "муж", "мужской"].includes(g)) return "m";
  if (["f", "ж", "female", "жен", "женский"].includes(g)) return "f";
  return undefined;
}

export function createPeopleStore(filePath: string): PeopleStore {
  const path = resolve(process.cwd(), filePath);
  let people = new Map<string, Person>();
  let selfWriteAt = 0; // метка своей записи — чтобы не ловить свой же fs.watch

  function reload(): void {
    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch {
      people = new Map();
      return; // файла нет — просто пустая мапа
    }

    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const next = new Map<string, Person>();
      for (const [id, entry] of Object.entries(parsed)) {
        if (!entry || typeof entry !== "object") continue;
        const e = entry as { name?: unknown; gender?: unknown };
        next.set(String(id), {
          name: e.name != null ? String(e.name) : undefined,
          gender: normalizeGender(e.gender),
        });
      }
      people = next;
    } catch (error) {
      console.warn(
        `people: не удалось разобрать ${path}:`,
        (error as Error).message,
      );
      // Оставляем прежнюю мапу, чтобы битая правка не обнуляла данные.
    }
  }

  function persist(): void {
    const obj: Record<string, Person> = {};
    for (const [id, { name, gender }] of people) {
      const entry: Person = {};
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
  function set(
    id: string,
    patch: { name?: string; gender?: string | undefined },
  ): Person | undefined {
    const key = String(id);
    const prev = people.get(key) ?? {};
    const next: Person = {
      name: "name" in patch ? patch.name || undefined : prev.name,
      gender: "gender" in patch ? normalizeGender(patch.gender) : prev.gender,
    };
    if (next.name == null && next.gender == null) people.delete(key);
    else people.set(key, next);
    persist();
    return people.get(key);
  }

  function remove(id: string): void {
    people.delete(String(id));
    persist();
  }

  reload();

  // Дебаунсим: редакторы часто дёргают файл несколько раз за сохранение.
  let debounce: ReturnType<typeof setTimeout> | null = null;
  try {
    watch(path, () => {
      if (Date.now() - selfWriteAt < 1000) return; // это была наша запись
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(reload, 200);
    }).unref();
  } catch {
    // watch не поддержан (напр. bind-mount) — спасает рестарт.
  }

  return { get: (id) => people.get(String(id)), set, remove, reload };
}
