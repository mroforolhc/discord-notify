export function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

const NO_CHANNELS = "Все голосовые каналы пусты";

function channelLines(channels) {
  return channels.map(
    (c) =>
      `<b>${escapeHtml(c.channelName)}</b>: ${c.members.map(escapeHtml).join(", ")}`,
  );
}

export function renderVoiceStatus(channels) {
  if (channels.length === 0) return NO_CHANNELS;
  return channelLines(channels).join("\n");
}

function visitLines(visit) {
  const name = escapeHtml(visit.memberName);

  // Оба события за одну сессию — склеиваем в одну фразу по их порядку.
  if (visit.joinAt != null && visit.leaveAt != null) {
    const text =
      visit.joinAt <= visit.leaveAt
        ? `${name} зашёл и вышел из Discord`
        : `${name} вышел и зашёл в Discord`;
    return [{ text, at: Math.max(visit.joinAt, visit.leaveAt) }];
  }

  if (visit.joinAt != null) {
    return [{ text: `${name} зашёл в Discord`, at: visit.joinAt }];
  }
  if (visit.leaveAt != null) {
    return [{ text: `${name} вышел из Discord`, at: visit.leaveAt }];
  }
  return [];
}

export function renderSessionMessage({ visits, channels, inviteUrl }) {
  const logLines = visits.flatMap(visitLines).sort((a, b) => a.at - b.at);

  const parts = logLines.map((line) => line.text);

  if (channels.length > 0) {
    parts.push("");
    parts.push(...channelLines(channels));

    if (inviteUrl) {
      parts.push("");
      parts.push(
        `<a href="${escapeHtml(inviteUrl)}">Зайти в Discord</a> (мяу мяу мяу)`,
      );
    }
  }

  return parts.join("\n");
}
