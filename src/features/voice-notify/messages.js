export function escapeHtml(text) {
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
};

function verb(kind, gender) {
  const forms = VERBS[kind];
  return gender === "m" ? forms.m : gender === "f" ? forms.f : forms.u;
}

// Каноничное имя из мапы перебивает Discord-ник (защита от спуфинга).
function resolvePerson(people, id, fallbackName) {
  const p = id != null ? people.get(id) : undefined;
  return { name: p?.name ?? fallbackName, gender: p?.gender };
}

function channelLines(channels, people) {
  return channels.map((c) => {
    const names = c.members.map((m) =>
      escapeHtml(resolvePerson(people, m.id, m.displayName).name),
    );
    return `<b>${escapeHtml(c.channelName)}</b>: ${names.join(", ")}`;
  });
}

export function renderVoiceStatus(channels, people) {
  if (channels.length === 0) return NO_CHANNELS;
  return channelLines(channels, people).join("\n");
}

function visitLines(visit, people) {
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

export function renderSessionMessage({ visits, channels, inviteUrl, people }) {
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
