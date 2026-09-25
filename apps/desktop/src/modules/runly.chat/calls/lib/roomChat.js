// Merge polled DB messages with live LiveKit-data-channel messages, deduped by
// id, sorted by createdAt then id. Live messages that lack a real id
// (optimistic echoes) are kept only until a DB row with matching body + sender
// + a close timestamp arrives.
export function mergeRoomMessages(dbMessages = [], liveMessages = []) {
  const byId = new Map();
  for (const m of dbMessages) byId.set(m.id, m);
  for (const m of liveMessages) {
    if (m.id && byId.has(m.id)) continue;
    if (m.id) { byId.set(m.id, m); continue; }
    const dup = dbMessages.some(
      (d) => d.body === m.body
        && d.senderName === m.senderName
        && Math.abs(new Date(d.createdAt).getTime() - new Date(m.createdAt).getTime()) < 15000,
    );
    if (!dup) byId.set(m.localId ?? `local:${m.createdAt}:${m.body}`, m);
  }
  return [...byId.values()].sort((a, b) => {
    const t = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    return t !== 0 ? t : String(a.id ?? "").localeCompare(String(b.id ?? ""));
  });
}

// Marks each message with isFirst/isLast within its run of consecutive
// messages from the same sender (senderName + senderKind — a name collision
// across a kind change, e.g. a guest and a member sharing a display name,
// must not merge into one visual group), so RoomChatView can show the
// avatar/sender name only once per run instead of on every bubble. Assumes
// `messages` is already time-sorted (mergeRoomMessages does this).
export function groupConsecutiveBySender(messages = []) {
  const key = (m) => `${m?.senderName ?? ""}::${m?.senderKind ?? ""}`;
  return messages.map((m, i) => {
    const prev = messages[i - 1];
    const next = messages[i + 1];
    return {
      ...m,
      isFirst: !prev || key(prev) !== key(m),
      isLast: !next || key(next) !== key(m),
    };
  });
}
