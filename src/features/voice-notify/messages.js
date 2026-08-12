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
      `${escapeHtml(c.channelName)}: ${c.members
        .map((m) => escapeHtml(m.name))
        .join(", ")}`,
  );
}

// HTML-текст для команды /status (отправлять с parse_mode: HTML).
export function renderVoiceStatus(channels) {
  if (channels.length === 0) return NO_CHANNELS;
  return channelLines(channels).join("\n");
}

// «A» / «A и B» / «A, B и C». Имена экранируются.
// TODO: сюда же можно повесить склонение по мапе ников.
function namesList(names) {
  const escaped = names.map(escapeHtml);
  if (escaped.length <= 1) return escaped.join("");
  return `${escaped.slice(0, -1).join(", ")} и ${escaped.at(-1)}`;
}

// Правильное «раз/раза/раз» для числа.
function razWord(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "раз";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "раза";
  return "раз";
}

function ch(name) {
  return `«${escapeHtml(name)}»`;
}

// «к A и B» либо «в «Канал», сидит один» — куда пришёл / где сейчас.
function destPart(others, toChannelName) {
  return others.length > 0
    ? `к ${namesList(others)}`
    : `в ${ch(toChannelName)}, сидит один`;
}

function joinersClause(joiners, others, channelName) {
  const verb = joiners.length === 1 ? "зашёл" : "зашли";
  if (others.length > 0) {
    return `${namesList(joiners)} ${verb} к ${namesList(others)}`;
  }
  if (joiners.length === 1) {
    return `${namesList(joiners)} зашёл в ${ch(channelName)}, сидит один`;
  }
  return `${namesList(joiners)} зашли в ${ch(channelName)}`;
}

function leaversClause(leavers, channelName) {
  const verb = leavers.length === 1 ? "вышел" : "вышли";
  return `${namesList(leavers)} ${verb} из ${ch(channelName)}`;
}

function bouncerClause(bouncer, others, channelName) {
  const name = escapeHtml(bouncer.name);
  const { leaves, netIn } = bouncer;

  if (netIn) {
    const back = others.length > 0 ? `к ${namesList(others)}` : `в ${ch(channelName)}`;
    return `${name} зашёл и вышел ${leaves} ${razWord(leaves)} и снова зашёл ${back}`;
  }
  if (leaves === 1) {
    return others.length > 0
      ? `${name} зашёл к ${namesList(others)} и вышел`
      : `${name} заглянул в ${ch(channelName)} и вышел`;
  }
  return `${name} зашёл и вышел ${leaves} ${razWord(leaves)}`;
}

// Сегмент про один канал: заходы/выходы/«поскакал» его актёров.
// joiners/leavers — имена; bouncers — [{ name, leaves, netIn }];
// others — присутствующие, не участвующие в бёрсте. Без префикса-ссылки.
export function renderChannelSegment({
  channelName,
  joiners,
  leavers,
  bouncers,
  others,
}) {
  const clauses = [];
  if (joiners.length > 0) clauses.push(joinersClause(joiners, others, channelName));
  if (leavers.length > 0) clauses.push(leaversClause(leavers, channelName));
  for (const b of bouncers) clauses.push(bouncerClause(b, others, channelName));
  return clauses.join("; ");
}

// Сегмент про переход одного человека между каналами. Без префикса-ссылки.
export function renderMoveSegment({
  name,
  moveCount,
  fromChannelName,
  fromRemain,
  toChannelName,
  others,
}) {
  const dest = destPart(others, toChannelName);
  if (moveCount <= 1) {
    const src =
      fromRemain.length > 0 ? `сидел с ${namesList(fromRemain)}` : "был один";
    return `${escapeHtml(name)} перешёл из ${ch(fromChannelName)} (${src}) ${dest}`;
  }
  return `${escapeHtml(name)} мечется по каналам, остановился ${dest}`;
}

// Одно сообщение окна: все сегменты (каналы + переходы) с префиксом-ссылкой.
export function renderWindow({ segments, inviteUrl }) {
  const prefix = inviteUrl
    ? `<a href="${escapeHtml(inviteUrl)}">Discord</a>: `
    : "";
  return `${prefix}${segments.join("\n")}`;
}
