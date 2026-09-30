// Shared by the publisher and Settings so a displayed default is also enforced.
//
// Note: enabling email for `chat.message.new` / `chat.thread.reply` does NOT mean
// "one email per message". chat-service.js additionally gates chat-message email
// on recipient inactivity (RUNLY_CHAT_EMAIL_AWAY_MINUTES) plus a per-conversation
// throttle (RUNLY_CHAT_EMAIL_THROTTLE_HOURS). Mentions and channel-adds are the
// IMPORTANT_EVENTS below and do email on every occurrence.
const IMPORTANT_EVENTS = new Set([
  'projects.member.added',
  'projects.task.assigned',
  'projects.task.mention',
  'chat.member.added',
  'chat.mention.new',
  'notes.note.shared',
  'inventory.item.mention',
  'inventory.item.deregistration_proposed',
]);

export function getDefaultNotificationPreference(eventType) {
  const important = IMPORTANT_EVENTS.has(eventType);
  return {
    inAppEnabled: true,
    emailEnabled: important,
    pushEnabled: important || eventType === 'chat.call.incoming',
  };
}
