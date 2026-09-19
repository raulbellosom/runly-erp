import { useMemo, useEffect, useRef } from "react";
import { useIsMobile, useSwipeToReply } from "@runly/ui";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import "../chat-theme.css";
import { ChatSidebar } from "../components/ChatSidebar";
import { ChatWindow } from "../components/ChatWindow";
import { useChatConversations, useArchivedConversations } from "../hooks/useChatConversations";
import { useEnsureMiraiConversation } from "../hooks/useMirAI";
import { ChatPreferencesProvider, useChatPreferences, chatPreferencesStyle } from "../hooks/useChatPreferences";

export function ChatScreen() {
  return (
    <ChatPreferencesProvider>
      <ChatScreenInner />
    </ChatPreferencesProvider>
  );
}

function ChatScreenInner() {
  const { "*": wildcard } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialFilesView = searchParams.get("view") === "files";
  const jumpMessageId = searchParams.get("msg");

  // Extract conversation ID from /chat/inbox/<id>
  const conversationIdFromUrl = useMemo(() => {
    const match = (wildcard ?? "").match(/^chat\/inbox\/(.+)$/);
    return match ? match[1] : null;
  }, [wildcard]);

  const mobileShowWindow = Boolean(conversationIdFromUrl);
  const isMobile = useIsMobile();
  const windowRef = useRef(null);

  const { data, isLoading } = useChatConversations();

  // Make sure the user's MirAI conversation exists (backend also self-heals
  // in GET /chat/conversations). Fire-and-forget; the row shows up on the next
  // conversations refetch.
  useEnsureMiraiConversation();

  // MirAI always sits at the very top, above any other pinned conversation.
  const conversations = useMemo(() => {
    const list = data?.data ?? [];
    return list.slice().sort((a, b) => {
      const am = a.type === "mirai" ? 1 : 0;
      const bm = b.type === "mirai" ? 1 : 0;
      return bm - am;
    });
  }, [data]);

  // A conversation opened via URL may have just been archived (or already
  // was) — it disappears from useChatConversations' list the moment that
  // happens, per the backend's own archiveClause default. Fall back to the
  // archived list rather than letting activeConversation silently resolve
  // to null and the window go blank; only fetched when actually needed.
  const needsArchivedLookup = Boolean(
    conversationIdFromUrl && !conversations.some((c) => c.id === conversationIdFromUrl),
  );
  const { data: archivedData } = useArchivedConversations({ enabled: needsArchivedLookup });
  const archivedConversations = archivedData?.data ?? [];

  const activeConversation = useMemo(
    () =>
      conversations.find((c) => c.id === conversationIdFromUrl) ??
      archivedConversations.find((c) => c.id === conversationIdFromUrl) ??
      null,
    [conversations, archivedConversations, conversationIdFromUrl],
  );

  function handleSelect(conv, messageId) {
    const qs = messageId ? `?msg=${encodeURIComponent(messageId)}` : "";
    navigate(`/app/m/runly.chat/chat/inbox/${conv.id}${qs}`, { replace: Boolean(conversationIdFromUrl) });
  }

  function handleCreated(conv) {
    if (conv?.id) {
      navigate(`/app/m/runly.chat/chat/inbox/${conv.id}`, { replace: Boolean(conversationIdFromUrl) });
    }
  }

  function handleClose() {
    navigate("/app/m/runly.chat/chat/inbox", { replace: true });
  }

  const { handlers: backSwipe } = useSwipeToReply({
    direction: "left",
    threshold: 90,
    disabled: !isMobile || !mobileShowWindow,
    onReply: handleClose,
  });

  useEffect(() => {
    const node = windowRef.current;
    if (!node || !isMobile || !mobileShowWindow) return;
    // Safari reserves edge touches for browser history. Keep these inside
    // the chat; ordinary vertical scrolling and controls remain native.
    function containEdgeGesture(event) {
      if (event.touches.length !== 1 || event.target.closest('button,a,input,textarea,[contenteditable="true"],[role="dialog"]')) return;
      const x = event.touches[0].clientX;
      if (x < 20 || x > window.innerWidth - 20) event.preventDefault();
    }
    node.addEventListener("touchstart", containEdgeGesture, { passive: false });
    return () => node.removeEventListener("touchstart", containEdgeGesture);
  }, [isMobile, mobileShowWindow]);

  const { prefs } = useChatPreferences();

  return (
    <div className="chat-glass-theme flex h-full min-h-0 overflow-hidden" style={chatPreferencesStyle(prefs)}>
      {/* Conversation list — full width on mobile, fixed 288px on desktop */}
      <div
        className={[
          "flex flex-col shrink-0 w-full md:w-72 min-h-0 overflow-hidden",
          mobileShowWindow ? "hidden md:flex" : "flex",
        ].join(" ")}
      >
        <ChatSidebar
          conversations={conversations}
          isLoading={isLoading}
          activeId={activeConversation?.id}
          onSelect={handleSelect}
          onCreated={handleCreated}
        />
      </div>

      {/* Chat window — fills remaining space */}
      <div
        ref={windowRef}
        {...backSwipe}
        onPointerDown={(event) => {
          if (event.pointerType !== "touch" || !event.currentTarget.contains(event.target)) return;
          if (event.target.closest('button,a,input,textarea,[contenteditable="true"],[role="dialog"],[aria-pressed]')) return;
          backSwipe.onPointerDown?.(event);
        }}
        style={isMobile ? { touchAction: "pan-y", overscrollBehaviorX: "contain" } : undefined}
        className={[
          "flex flex-1 min-w-0 min-h-0 overflow-hidden",
          mobileShowWindow ? "flex" : "hidden md:flex",
        ].join(" ")}
      >
        <ChatWindow
          conversation={activeConversation}
          onClose={handleClose}
          initialFilesView={initialFilesView}
          initialJumpMessageId={jumpMessageId}
        />
      </div>
    </div>
  );
}
