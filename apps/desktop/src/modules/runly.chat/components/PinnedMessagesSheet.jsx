// apps/desktop/src/modules/runly.chat/components/PinnedMessagesSheet.jsx
import { Sheet, SheetContent, SheetHeader, SheetTitle, EmptyState, Skeleton, Button, renderMentionText } from "@runly/ui";
import { Pin } from "lucide-react";
import { usePinnedMessages } from "../hooks/usePinnedMessages";
import { usePinMessage } from "../hooks/useChatMessages";
import { formatMessageTime } from "../lib/chatUtils";
import { roleHasPermission, findOwnMember, CHAT_PERMISSIONS } from "../lib/chatPermissions";
import { useChatPreferences, chatPreferencesStyle } from "../hooks/useChatPreferences";
import "../chat-theme.css";

export function PinnedMessagesSheet({ open, onOpenChange, conversationId, currentUserId, members, onJumpToMessage }) {
  const { data, isLoading } = usePinnedMessages(conversationId, { enabled: open });
  const { mutate: pinMutate } = usePinMessage(conversationId);
  const { prefs } = useChatPreferences();
  const messages = data?.data ?? [];
  const ownMember = findOwnMember(members ?? [], currentUserId);
  const canUnpin = roleHasPermission(ownMember, CHAT_PERMISSIONS.MESSAGES_PIN);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="chat-glass-theme chat-glass w-full sm:max-w-md flex flex-col"
        style={chatPreferencesStyle(prefs)}
      >
        <SheetHeader>
          <SheetTitle className="chat-font-display flex items-center gap-2">
            <Pin className="h-4 w-4 text-[hsl(var(--primary))]" />
            Mensajes fijados
          </SheetTitle>
        </SheetHeader>

        <div className="flex-1 min-h-0 overflow-y-auto space-y-2 py-3">
          {isLoading && (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
            </div>
          )}

          {!isLoading && !messages.length && (
            <EmptyState icon={Pin} title="Sin mensajes fijados" description="Los mensajes importantes fijados apareceran aqui." />
          )}

          {messages.map((msg) => (
            <div key={msg.id} className="rounded-lg border border-[hsl(var(--border))] px-3 py-2.5">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-xs font-medium truncate">{msg.sender?.displayName ?? "Usuario"}</span>
                <span className="text-[10px] text-[hsl(var(--muted-foreground))] shrink-0">{formatMessageTime(msg.created_at)}</span>
              </div>
              <p className="text-sm line-clamp-3 whitespace-pre-wrap wrap-anywhere">
                {msg.body ? renderMentionText(msg.body) : <span className="italic text-[hsl(var(--muted-foreground))]">Archivo adjunto</span>}
              </p>
              <div className="flex items-center gap-2 mt-2">
                <Button size="sm" variant="outline" onClick={() => onJumpToMessage?.(msg.id, msg.thread_root_id)}>Ver en el chat</Button>
                {canUnpin && (
                  <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-500" onClick={() => pinMutate({ messageId: msg.id, pinned: false })}>
                    Desfijar
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
