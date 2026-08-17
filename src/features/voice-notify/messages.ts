import type { PeopleStore, Gender } from "../../people/store.js";

export interface VoiceMember {
  id: string;
  displayName: string;
  username: string;
  avatarUrl: string;
}

export interface VoiceChannel {
  channelId: string;
  channelName: string;
  members: VoiceMember[];
}

export interface Visit {
  memberId: string;
  memberName: string;
  joinAt: number | null;
  leaveAt: number | null;
  lastEventAt: number;
}

export function escapeHtml(text: string): string {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

const NO_CHANNELS = "Все голосовые каналы пусты";

// Формы глаголов по полу. "u" — пол неизвестен (нет в мапе): двойная форма.
const VERBS = {
  join: { m: "зашёл", f: "зашла", u: "зашёл(ла)" },
  leave: { m: "вышел", f: "вышла", u: "вышел(ла)" },
} as const;

function verb(kind: "join" | "leave", gender: Gender | undefined): string {
  const forms = VERBS[kind];
  return gender === "m" ? forms.m : gender === "f" ? forms.f : forms.u;
}

// Каноничное имя из мапы перебивает Discord-ник (защита от спуфинга).
function resolvePerson(
  people: PeopleStore,
  id: string,
  fallbackName: string,
): { name: string; gender: Gender | undefined } {
  const p = people.get(id);
  return { name: p?.name ?? fallbackName, gender: p?.gender };
}

function channelLines(channels: VoiceChannel[], people: PeopleStore): string[] {
  return channels.map((c) => {
    const names = c.members.map((m) =>
      escapeHtml(resolvePerson(people, m.id, m.displayName).name),
    );
    return `<b>${escapeHtml(c.channelName)}</b>: ${names.join(", ")}`;
  });
}

export function renderVoiceStatus(
  channels: VoiceChannel[],
  people: PeopleStore,
): string {
  if (channels.length === 0) return NO_CHANNELS;
  return channelLines(channels, people).join("\n");
}

function visitLines(
  visit: Visit,
  people: PeopleStore,
): { text: string; at: number }[] {
  const { name: rawName, gender } = resolvePerson(
    people,
    visit.memberId,
    visit.memberName,
  );
  const name = escapeHtml(rawName);
  const join = verb("join", gender);
  const leave = verb("leave", gender);

  // Оба события за одну сессию — склеиваем в одну фразу по их порядку.
  if (visit.joinAt != null && visit.leaveAt != null) {
    const text =
      visit.joinAt <= visit.leaveAt
        ? `${name} ${join} и ${leave} из Discord`
        : `${name} ${leave} и ${join} в Discord`;
    return [{ text, at: Math.max(visit.joinAt, visit.leaveAt) }];
  }

  if (visit.joinAt != null) {
    return [{ text: `${name} ${join} в Discord`, at: visit.joinAt }];
  }
  if (visit.leaveAt != null) {
    return [{ text: `${name} ${leave} из Discord`, at: visit.leaveAt }];
  }
  return [];
}

export function renderSessionMessage({
  visits,
  channels,
  inviteUrl,
  people,
}: {
  visits: Visit[];
  channels: VoiceChannel[];
  inviteUrl: string | null;
  people: PeopleStore;
}): string {
  const logLines = visits
    .flatMap((v) => visitLines(v, people))
    .sort((a, b) => a.at - b.at);

  const parts = logLines.map((line) => line.text);

  if (channels.length > 0) {
    parts.push("");
    parts.push(...channelLines(channels, people));

    if (inviteUrl) {
      parts.push("");
      parts.push(
        `<a href="${escapeHtml(inviteUrl)}">Зайти в Discord</a> (мяу мяу мяу)`,
      );
    }
  }

  return parts.join("\n");
}
