import { MessageSquare } from "lucide-react";
import { useChatUnreadCount } from "../modules/runly.chat/hooks/useChatConversations";

// Topbar counterpart to NotificationBell — unread *chat* messages (DMs,
// groups, channels) are a distinct, high-volume stream from the generic
// Notification table NotificationBell reads, and previously had no signal
// at all outside the Chat module screen itself (docs/TASKS.md tracked this
// as "Notification integration: unread badge in topbar").
export function ChatBell({ onOpen }) {
  const unreadCount = useChatUnreadCount();

  return (
    <button
      type="button"
      onClick={onOpen}
      title="Chat"
      aria-label={unreadCount > 0 ? `Chat, ${unreadCount} sin leer` : "Chat"}
      className="relative h-9 w-9 flex items-center justify-center rounded-lg cursor-pointer text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors duration-150 outline-none"
    >
      <MessageSquare size={16} />
      {unreadCount > 0 && (
        <span className="absolute top-1 right-1 h-4 min-w-4 px-0.5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center leading-none pointer-events-none shadow-[0_0_8px_rgba(239,68,68,0.65)]">
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      )}
    </button>
  );
}
