import { AtSign, Pin, Sparkles } from "lucide-react";
import { AssistantWordmark, renderMentionText } from "@runly/ui";
import { formatMessageTime } from "../lib/chatUtils";
import { ConversationTypeBadge } from "./ConversationTypeBadge";

function getInitials(name) {
  if (!name) return "?";
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function Avatar({ name, avatarUrl, avatarEmoji, type, size = "md", online = false, isBot = false }) {
  const sizeClass = size === "sm" ? "h-8 w-8 text-xs" : "h-10 w-10 text-sm";
  if (isBot) {
    return (
      <div className="relative shrink-0">
        <div
          className={`${sizeClass} rounded-full flex items-center justify-center`}
          style={{ backgroundColor: "var(--brand-primary)", color: "var(--brand-primary-foreground)" }}
        >
          <Sparkles className="h-4 w-4" />
        </div>
        <span className="absolute -bottom-0.5 -right-0.5 rounded-full bg-[hsl(var(--background))] px-1 text-[9px] font-bold leading-tight text-[hsl(var(--primary))] ring-1 ring-[hsl(var(--primary)/0.4)]">
          IA
        </span>
      </div>
    );
  }
  return (
    <div className="relative shrink-0">
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt={name}
          className={`${sizeClass} rounded-full object-cover`}
        />
      ) : avatarEmoji ? (
        <div
          className={`${sizeClass} rounded-full flex items-center justify-center bg-[hsl(var(--muted))]`}
        >
          <span className="text-lg leading-none">{avatarEmoji}</span>
        </div>
      ) : (
        <div
          className={`${sizeClass} rounded-full flex items-center justify-center font-semibold`}
          style={{ backgroundColor: "var(--brand-primary)", color: "var(--brand-primary-foreground)" }}
        >
          {getInitials(name)}
        </div>
      )}
      {online && (
        <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-green-500 ring-2 ring-[hsl(var(--background))]" />
      )}
      <ConversationTypeBadge type={type} />
    </div>
  );
}

export function ChatConversationItem({ conversation, isActive, onClick, currentUserId, isOnline = false }) {
  const isMirai = conversation.type === "mirai";
  const otherMember = conversation.type === "direct"
    ? (conversation.members ?? []).find((m) => m.userId !== currentUserId)
    : null;

  const displayName = isMirai
    ? "MirAI"
    : (conversation.title ??
      otherMember?.displayName ??
      (conversation.type === "group" ? "Grupo" : "Conversacion directa"));
  // Prefixed only for the visible label — Avatar below still gets the raw
  // displayName so its initials fallback shows the channel's real first
  // letter, not "#".
  const titleLabel = conversation.type === "channel" ? `#${displayName}` : displayName;

  const avatarUrl = conversation.avatarUrl ?? otherMember?.avatarUrl ?? null;
  const avatarEmoji = conversation.avatar_emoji ?? null;
  const lastMsg = conversation.last_message;
  const unread = conversation.unread_count ?? 0;
  const unreadMentions = conversation.unread_mention_count ?? 0;

  let lastMsgPreview = "";
  if (lastMsg) {
    if (lastMsg.messageType === "system") {
      lastMsgPreview = lastMsg.body;
    } else if (lastMsg.messageType === "image") {
      lastMsgPreview = "Imagen";
    } else if (lastMsg.messageType === "file") {
      lastMsgPreview = "Archivo adjunto";
    } else {
      lastMsgPreview = lastMsg.body ?? "";
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onClick}
        className={[
          "w-full flex items-center gap-3 px-3 py-2.5 rounded-2xl text-left transition-colors",
          isActive
            ? "bg-[hsl(var(--primary)/0.1)] text-[hsl(var(--primary))] shadow-[0_0_16px_hsl(var(--primary)/0.18)] ring-1 ring-[hsl(var(--primary)/0.25)]"
            : "hover:bg-[hsl(var(--muted))] text-[hsl(var(--foreground))]",
        ].join(" ")}
      >
        <Avatar name={displayName} avatarUrl={avatarUrl} avatarEmoji={avatarEmoji} type={conversation.type} online={isOnline} isBot={isMirai} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm truncate chat-font-display font-semibold flex items-center gap-1 min-w-0">
              {conversation.is_pinned && (
                <Pin className="h-3 w-3 shrink-0 text-[hsl(var(--muted-foreground))] fill-current" />
              )}
              <span className="truncate">{isMirai ? <AssistantWordmark className="text-foreground" /> : titleLabel}</span>
            </span>
            {lastMsg?.createdAt && (
              <span className="text-xs text-[hsl(var(--muted-foreground))] shrink-0">
                {formatMessageTime(lastMsg.createdAt)}
              </span>
            )}
          </div>
          <div className="flex items-center justify-between gap-2 mt-0.5">
            <p className="text-xs text-[hsl(var(--muted-foreground))] truncate">
              {lastMsgPreview ? renderMentionText(lastMsgPreview) : "Sin mensajes"}
            </p>
            <div className="flex items-center gap-1 shrink-0">
              {unreadMentions > 0 && (
                <span
                  title={`${unreadMentions} mencion${unreadMentions === 1 ? "" : "es"} sin leer`}
                  className="inline-flex items-center justify-center h-4.5 min-w-[1.125rem] px-1 rounded-full bg-accent text-white text-[10px] font-semibold"
                >
                  <AtSign className="h-2.5 w-2.5" strokeWidth={3} />
                  {unreadMentions > 9 ? "9+" : unreadMentions}
                </span>
              )}
              {unread > 0 && (
                <span className="inline-flex items-center justify-center h-4.5 min-w-[1.125rem] px-1 rounded-full bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] text-[10px] font-semibold">
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </div>
          </div>
        </div>
      </button>
    </div>
  );
}
