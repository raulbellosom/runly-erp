import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import "../chat-theme.css";
import {
  X, Minus, ChevronUp,
  ExternalLink, FolderOpen, MoreVertical, User, Users, Phone, Video, Pin,
} from "lucide-react";
import { Button, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@runly/ui";
import { useChatMessages, useSendMessage, useMarkRead, useDeleteMessage, useEditMessage, useDeleteAttachment, usePinMessage, useToggleReaction } from "../hooks/useChatMessages";
import { useChatConversationDetail } from "../hooks/useChatConversationDetail";
import { usePinnedMessages } from "../hooks/usePinnedMessages";
import { MessageComposer } from "./MessageComposer";
import { DropZoneOverlay } from "./DropZoneOverlay";
import { ChatMessageList } from "./ChatMessageList";
import { ChatAttachmentViewer } from "./ChatAttachmentViewer";
import { PinnedMessagesSheet } from "./PinnedMessagesSheet";
import { ThreadPanel } from "./ThreadPanel";
import { ConversationProfilePanel } from "./ConversationProfilePanel";
import { AvatarCircle } from "./AvatarCircle";
import { useChatFloatStore } from "../store/chatFloatStore";
import { roleHasPermission, findOwnMember, CHAT_PERMISSIONS } from "../lib/chatPermissions";
import { getConversationDisplayName, getConversationTitleLabel, buildAllAttachments } from "../lib/chatUtils";
import { ChatPreferencesProvider, useChatPreferences, chatPreferencesStyle } from "../hooks/useChatPreferences";
import { useTtsStatus, useSpeakText } from "../hooks/useTextToSpeech";
import { useAuth } from "../../../auth/AuthProvider";
import { useCalls } from "../calls/CallsProvider";

const BS = 56;     // bubble size px
const BM = 16;     // margin from edge px
const WW = 300;    // mini-window width px
const WH = 380;    // mini-window height px
const WH_MIN = 44; // minimized height px
const GAP = 8;     // gap between elements px

export function getAvatarUrl(conversation, currentUserId) {
  if (conversation.avatarUrl) return conversation.avatarUrl;
  if (conversation.type === "direct") {
    const other = (conversation.members ?? []).find((m) => m.userId !== currentUserId);
    return other?.avatarUrl ?? null;
  }
  return null;
}

export function getAvatarEmoji(conversation) {
  return conversation?.avatar_emoji ?? null;
}

export { AvatarCircle } from "./AvatarCircle";

// --- Mini chat window (desktop) ---

// Wrapped so useChatPreferences() (called below, to size the font and set
// the accent color on this window's own .chat-glass-theme root) has a
// provider to read from — each floating mini window gets its own Provider
// instance, all reading/writing the same localStorage key, so a change made
// from the main ChatScreen settings dialog applies here the next time this
// widget mounts.
export function MiniChatWindow(props) {
  return (
    <ChatPreferencesProvider>
      <MiniChatWindowInner {...props} />
    </ChatPreferencesProvider>
  );
}

function MiniChatWindowInner({ entry, index, edge, zIndex = 45, onClose, onMinimize }) {
  const { id, conversation, minimized } = entry;
  const { userProfile } = useAuth();
  const { enabled: callsEnabled, isStarting: callPending, startCall } = useCalls();
  const navigate = useNavigate();
  const { openChat } = useChatFloatStore();
  const { data, isLoading, hasMore, isLoadingMore, loadMore } = useChatMessages(id);
  const { mutateAsync: send } = useSendMessage(id);
  const { mutate: markRead } = useMarkRead(id);
  const { mutate: deleteMessageMutate } = useDeleteMessage(id);
  const { mutateAsync: editMessageMutate } = useEditMessage(id);
  const { mutate: deleteAttachmentMutate, isPending: isDeletingAttachment, variables: deletingAttachmentId } = useDeleteAttachment(id);
  const { mutate: pinMutate } = usePinMessage(id);
  // Own instance, independent of any main ChatWindow.jsx open elsewhere —
  // this is a separate floating popup, no shared "now playing" bar here (too
  // small a surface to spare the space for one; the per-message icon in
  // ChatMessageList is enough).
  const { data: ttsStatus } = useTtsStatus();
  const ttsEnabled = Boolean(ttsStatus?.enabled);
  const speech = useSpeakText();
  const { mutate: toggleReactionMutate } = useToggleReaction(id);
  // `conversation` here is whatever was passed to openChat() — usually the
  // list-preview shape (5-member slice, no role/permission fields). The
  // detail query is needed for messages.pin gating, same as ChatWindow.
  const { data: conversationDetail } = useChatConversationDetail(id);
  const detailMembers = conversationDetail?.data?.members ?? null;
  const isChannelOrGroupType = conversation?.type === "channel" || conversation?.type === "group";
  const ownMemberForComposer = findOwnMember(detailMembers ?? conversation?.members ?? [], userProfile?.id);
  const canSendMessages = !isChannelOrGroupType || roleHasPermission(ownMemberForComposer, CHAT_PERMISSIONS.MESSAGES_SEND);
  const { data: pinnedData } = usePinnedMessages(id, { enabled: isChannelOrGroupType });
  const pinnedMessages = isChannelOrGroupType ? (pinnedData?.data ?? []) : [];
  const canPinMessages = isChannelOrGroupType && roleHasPermission(ownMemberForComposer, CHAT_PERMISSIONS.MESSAGES_PIN);
  const { prefs } = useChatPreferences();
  const markReadRef = useRef(markRead);
  markReadRef.current = markRead;

  // Same snapshot ChatWindow.jsx takes — captured during render, before the
  // markRead effect's mutation invalidates the conversations list and zeroes
  // this out. Lets ChatMessageList open scrolled to the first unread message
  // instead of the bottom, and scope the mention jump button to what's
  // actually unread.
  const unreadSnapshotRef = useRef({ id: null, count: 0 });
  if (unreadSnapshotRef.current.id !== id) {
    unreadSnapshotRef.current = { id, count: conversation?.unread_count ?? 0 };
  }

  const composerRef = useRef(null);
  const [isDragOver, setIsDragOver] = useState(false);
  // No local attachments array — the viewer always renders allAttachments
  // below, positioned at the clicked file's index in it, same reasoning as
  // ChatWindow.jsx's own viewer state.
  const [viewer, setViewer] = useState({ open: false, activeIndex: 0 });
  const allAttachments = useMemo(() => buildAllAttachments(data?.data ?? []), [data]);
  const [hiddenMsgIds, setHiddenMsgIds] = useState(() => new Set());
  const [profileView, setProfileView] = useState(false);
  const [replyingTo, setReplyingTo] = useState(null);
  const [editingMessage, setEditingMessage] = useState(null);
  const [jumpTarget, setJumpTarget] = useState(null);
  const [threadRootId, setThreadRootId] = useState(null);
  const [showPinned, setShowPinned] = useState(false);

  useEffect(() => { setReplyingTo(null); setEditingMessage(null); setThreadRootId(null); setShowPinned(false); }, [id]);

  const handleSubmitEdit = useCallback(
    async (messageId, body) => { await editMessageMutate({ messageId, body }); },
    [editMessageMutate],
  );

  const handleJumpToMessage = useCallback((messageId, rootId) => {
    setShowPinned(false);
    if (rootId) { setThreadRootId(rootId); return; }
    setProfileView(false);
    setJumpTarget({ id: messageId, nonce: Date.now() });
  }, []);

  useEffect(() => { if (!minimized) markReadRef.current(); }, [id, minimized]);

  // Escape closes the profile view (back to messages) if it's open, matching
  // ChatWindow's equivalent handling for its own plain-state overlays.
  useEffect(() => {
    if (!profileView) return;
    function onKeyDown(e) {
      if (e.key === "Escape") setProfileView(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [profileView]);

  const name = getConversationDisplayName(conversation, userProfile?.id);
  const titleLabel = getConversationTitleLabel(conversation, userProfile?.id);
  const avatarUrl = getAvatarUrl(conversation, userProfile?.id);
  const avatarEmoji = getAvatarEmoji(conversation);
  const offset = BM + BS + GAP + index * (WW + GAP);

  const handleAttachmentClick = useCallback((attachments, activeIndex) => {
    const clickedId = attachments?.[activeIndex]?.id;
    const globalIdx = allAttachments.findIndex((f) => f.id === clickedId);
    setViewer({ open: true, activeIndex: globalIdx >= 0 ? globalIdx : 0 });
  }, [allAttachments]);

  function handleViewInChat() {
    navigate(`/app/m/runly.chat/chat/inbox/${id}`);
    onClose();
  }

  function handleViewFiles() {
    navigate(`/app/m/runly.chat/chat/inbox/${id}?view=files`);
    onClose();
  }

  function handleDragOver(e) {
    e.preventDefault();
    if (!minimized) setIsDragOver(true);
  }

  function handleDragLeave(e) {
    if (!e.currentTarget.contains(e.relatedTarget)) setIsDragOver(false);
  }

  function handleDrop(e) {
    e.preventDefault();
    setIsDragOver(false);
    if (minimized) return;
    const files = Array.from(e.dataTransfer.files);
    if (files.length) composerRef.current?.addFiles(files);
  }

  return (
    <>
      <div
        style={{
          position: "fixed",
          bottom: BM,
          width: WW,
          [edge]: offset,
          zIndex,
          height: minimized ? WH_MIN : WH,
          transition: "height 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
          ...chatPreferencesStyle(prefs),
        }}
        className="chat-glass-theme rounded-xl shadow-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] flex flex-col overflow-hidden relative"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Drop overlay */}
        {isDragOver && !minimized && <DropZoneOverlay compact rounded="rounded-xl" />}

        {/* Header — two modes */}
        {minimized ? (
          <div
            role="button"
            tabIndex={0}
            title={titleLabel}
            onClick={onMinimize}
            onKeyDown={(e) => e.key === "Enter" && onMinimize()}
            className="group flex items-center gap-1.5 px-2.5 h-11 cursor-pointer select-none"
            style={conversation?.unread_count > 0 ? {
              borderLeft: "4px solid #ef4444",
              background: "rgba(239,68,68,0.10)",
            } : {
              borderLeft: "4px solid transparent",
            }}
          >
            <AvatarCircle avatarUrl={avatarUrl} avatarEmoji={avatarEmoji} type={conversation?.type} name={name} size="sm" />
            <p className="flex-1 text-xs font-semibold truncate">{titleLabel}</p>
            {conversation?.unread_count > 0 && (
              <span
                className="flex items-center justify-center font-bold shrink-0 group-hover:hidden"
                style={{
                  minWidth: "1rem", height: "1rem",
                  borderRadius: "9999px",
                  background: "#ef4444", color: "#fff",
                  fontSize: "9px", padding: "0 3px",
                }}
              >
                {conversation.unread_count > 99 ? "99+" : conversation.unread_count}
              </span>
            )}
            <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onMinimize(); }}
                className="h-6 w-6 flex items-center justify-center rounded text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors"
                title="Expandir"
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onClose(); }}
                className="h-6 w-6 flex items-center justify-center rounded text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors"
                title="Cerrar"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ) : (
          <div
            className="chat-glass flex items-center gap-2 px-3 h-11 shrink-0"
          >
            <button
              type="button"
              onClick={onMinimize}
              className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer select-none text-left"
            >
              <AvatarCircle avatarUrl={avatarUrl} avatarEmoji={avatarEmoji} type={conversation?.type} name={name} size="sm" />
              <p className="chat-font-display flex-1 text-xs font-semibold truncate">{titleLabel}</p>
            </button>
            {/* Only call / video-call stay in the header row (per request) —
                the 300px window can't fit more without hiding the name. Every
                other control moved into the three-dots menu below. */}
            {callsEnabled && conversation?.type !== "external_support" && (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0"
                  onClick={() => startCall({ conversationId: id, kind: "AUDIO" })}
                  disabled={callPending}
                  title="Iniciar llamada de voz"
                >
                  <Phone className="h-3 w-3" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0"
                  onClick={() => startCall({ conversationId: id, kind: "VIDEO" })}
                  disabled={callPending}
                  title="Iniciar videollamada"
                >
                  <Video className="h-3 w-3" />
                </Button>
              </>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  onClick={(e) => e.stopPropagation()}
                  className="shrink-0 h-6 w-6 flex items-center justify-center rounded text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors touch-manipulation"
                  title="Opciones"
                >
                  <MoreVertical className="h-3 w-3" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" style={{ zIndex: 10000 }}>
                <DropdownMenuItem onSelect={() => setProfileView((v) => !v)}>
                  {isChannelOrGroupType
                    ? <><Users className="h-3.5 w-3.5 mr-2" />{profileView ? "Ver mensajes" : "Ver miembros"}</>
                    : <><User className="h-3.5 w-3.5 mr-2" />{profileView ? "Ver mensajes" : "Ver perfil"}</>}
                </DropdownMenuItem>
                {pinnedMessages.length > 0 && (
                  <DropdownMenuItem onSelect={() => setShowPinned(true)}>
                    <Pin className="h-3.5 w-3.5 mr-2" />
                    Mensajes fijados ({pinnedMessages.length})
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={handleViewInChat}>
                  <ExternalLink className="h-3.5 w-3.5 mr-2" />
                  Ver conversacion en el chat
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={handleViewFiles}>
                  <FolderOpen className="h-3.5 w-3.5 mr-2" />
                  Ver todos los archivos
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <button
              type="button"
              onClick={onMinimize}
              className="shrink-0 h-6 w-6 flex items-center justify-center rounded text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors touch-manipulation"
              title="Minimizar"
            >
              <Minus className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 h-6 w-6 flex items-center justify-center rounded text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors touch-manipulation"
              title="Cerrar"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        {!minimized && profileView && (
          <ConversationProfilePanel
            conversation={conversation}
            currentUserId={userProfile?.id}
            initialTab={null}
            onBack={() => setProfileView(false)}
            messages={data?.data ?? []}
            isLoadingMessages={isLoading}
            onShowAllFiles={handleViewFiles}
            onOpenConversation={(conv) => openChat(conv)}
            onDeleted={onClose}
            callsEnabled={callsEnabled}
            callPending={callPending}
            onStartAudioCall={() => startCall({ conversationId: id, kind: "AUDIO" })}
            onStartVideoCall={() => startCall({ conversationId: id, kind: "VIDEO" })}
          />
        )}
        {!minimized && !profileView && (
          <>
            <ChatMessageList
              key={id}
              messages={data?.data ?? []}
              isLoading={isLoading}
              ttsEnabled={ttsEnabled}
              speech={speech}
              currentUserId={userProfile?.id}
              typingUsers={[]}
              onAttachmentClick={handleAttachmentClick}
              members={detailMembers ?? conversation.members}
              conversationType={conversation?.type}
              hasMore={hasMore}
              isLoadingMore={isLoadingMore}
              onLoadMore={loadMore}
              unreadCountAtOpen={unreadSnapshotRef.current.count}
              onDeleteMessage={(msgId) => deleteMessageMutate(msgId)}
              onDeleteAttachment={(attachmentId) => deleteAttachmentMutate(attachmentId)}
              deletingAttachmentId={isDeletingAttachment ? deletingAttachmentId : null}
              onHideForMe={(msgId) => setHiddenMsgIds((prev) => { const n = new Set(prev); n.add(msgId); return n; })}
              onForward={() => { navigate(`/app/m/runly.chat/chat/inbox/${id}`); onClose(); }}
              hiddenMessageIds={hiddenMsgIds}
              onPinMessage={(messageId, pinned) => pinMutate({ messageId, pinned })}
              onToggleReaction={(messageId, emoji, attachmentId) => toggleReactionMutate({ messageId, emoji, attachmentId })}
              onOpenThread={(messageId) => setThreadRootId(messageId)}
              onJumpToThread={(threadRootId) => setThreadRootId(threadRootId)}
              onReplyToMessage={(msg) => { setEditingMessage(null); setReplyingTo(msg); }}
              onEditMessage={(msg) => { setReplyingTo(null); setEditingMessage(msg); }}
              onJumpToMessage={(msgId) => setJumpTarget({ id: msgId, nonce: Date.now() })}
              scrollToMessage={jumpTarget}
              pinnedMessages={pinnedMessages}
              onOpenPinnedList={() => setShowPinned(true)}
              onJumpToPinnedMessage={handleJumpToMessage}
              onUnpinMessage={(mid) => pinMutate({ messageId: mid, pinned: false })}
              canUnpinMessages={canPinMessages}
            />
            <MessageComposer
              ref={composerRef}
              onSend={send}
              placeholder={canSendMessages ? "Mensaje..." : "Solo un administrador puede escribir aqui"}
              compact
              conversationId={id}
              conversationType={conversation?.type}
              replyingTo={replyingTo}
              onCancelReply={() => setReplyingTo(null)}
              editingMessage={editingMessage}
              onCancelEdit={() => setEditingMessage(null)}
              onSubmitEdit={handleSubmitEdit}
              dropZoneDisabled
              disabled={!canSendMessages}
            />
          </>
        )}
      </div>

      <ChatAttachmentViewer
        open={viewer.open}
        onOpenChange={(open) => setViewer((v) => ({ ...v, open }))}
        attachments={allAttachments}
        activeIndex={viewer.activeIndex}
        onIndexChange={(i) => setViewer((v) => ({ ...v, activeIndex: i }))}
      />

      <PinnedMessagesSheet
        open={showPinned}
        onOpenChange={setShowPinned}
        conversationId={id}
        currentUserId={userProfile?.id}
        members={detailMembers ?? conversation.members}
        onJumpToMessage={handleJumpToMessage}
      />

      <ThreadPanel
        open={Boolean(threadRootId)}
        onOpenChange={(o) => { if (!o) setThreadRootId(null); }}
        rootMessageId={threadRootId}
        conversationId={id}
        conversationType={conversation?.type}
        members={detailMembers ?? conversation.members}
        onToggleReaction={(messageId, emoji, attachmentId) => toggleReactionMutate({ messageId, emoji, attachmentId })}
      />
    </>
  );
}
