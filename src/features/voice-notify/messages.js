export function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function formatTime(ts, timezone) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(ts);
}

export function formatDateTime(ts, timezone) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: timezone,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(ts);
}

const NO_CHANNELS = "Все голосовые каналы пусты";

function channelLines(channels) {
  return channels.map(
    (c) => `${escapeHtml(c.channelName)}: ${c.members.map(escapeHtml).join(", ")}`,
  );
}

export function renderVoiceStatus(channels) {
  if (channels.length === 0) return NO_CHANNELS;
  return channelLines(channels).join("\n");
}

function visitLines(visit) {
  const name = escapeHtml(visit.memberName);
  const lines = [];
  if (visit.joinAt != null) {
    lines.push({ text: `${name} зашёл в Discord`, at: visit.joinAt });
  }
  if (visit.leaveAt != null) {
    lines.push({ text: `${name} вышел из Discord`, at: visit.leaveAt });
  }
  return lines;
}

export function renderSessionMessage({
  visits,
  channels,
  inviteUrl,
  timezone,
  edited,
  updatedAt,
}) {
  const logLines = visits.flatMap(visitLines).sort((a, b) => a.at - b.at);
  const showTimes = logLines.length > 1;

  const parts = [];

  for (const line of logLines) {
    parts.push(
      showTimes ? `${line.text} · ${formatTime(line.at, timezone)}` : line.text,
    );
  }

  parts.push("");
  if (channels.length > 0) {
    const stamp =
      edited && updatedAt != null
        ? ` · обновлено ${formatDateTime(updatedAt, timezone)}`
        : "";
    parts.push(`<b>Сейчас в каналах</b>${stamp}`);
    parts.push(...channelLines(channels));
  } else {
    parts.push(NO_CHANNELS);
  }

  if (inviteUrl) {
    parts.push("");
    parts.push(`<a href="${escapeHtml(inviteUrl)}">Зайти в Discord</a> (мяу мяу мяу)`);
  }

  return parts.join("\n");
}
