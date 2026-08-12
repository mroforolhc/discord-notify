export function describeJoin(event) {
  const invitePart = event.inviteUrl
    ? `\n\n${event.inviteUrl} (мяу мяу мяу)`
    : "";
  return `${event.memberName} сейчас в ${event.channelName}${invitePart}`;
}

export function describeQuickLeave(event) {
  return `${event.memberName} был в ${event.channelName}, но уже вышел`;
}

export function describeLeave(event) {
  return `${event.memberName} вышел из ${event.channelName}`;
}
