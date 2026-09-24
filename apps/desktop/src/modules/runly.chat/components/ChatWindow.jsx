import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, MessageSquare } from "lucide-react";
import { runly } from "../../../lib/runly";
import { ChatTemplatePopover } from "./ChatTemplatePopover";
import { useConversationFiles } from "../hooks/useConversationFiles";
import { ErrorState } from "@runly/ui";
import { ChatFilesGallery } from "./ChatFilesGallery";
import { ChatRecordingsGallery } from "./ChatRecordingsGallery";
import { DropZoneOverlay } from "./DropZoneOverlay";
import { ChatMessageList } from "./ChatMessageList";
import { MirAIIntro } from "./MirAIIntro";
import { MirAIPanel } from "./MirAIPanel";
import { MessageComposer } from "./MessageComposer";
import { ChatAttachmentViewer } from "./ChatAttachmentViewer";
import { ForwardMessageModal } from "./ForwardMessageModal";
import { ConversationProfilePanel } from "./ConversationProfilePanel";
import { PinnedMessagesSheet } from "./PinnedMessagesSheet";
import { ThreadPanel } from "./ThreadPanel";
import { CallShareDialog } from "../calls/CallShareDialog";
import { usePinMessage } from "../hooks/useChatMessages";
import { useChatWindowData } from "../hooks/useChatWindowData";
import { usePinnedMessages } from "../hooks/usePinnedMessages";
import { useChatMessageSearch } from "../hooks/useChatMessageSearch";
import { useChatPresence } from "../hooks/useChatPresence";
import { useChatConversations, useArchiveConversation, useUnarchiveConversation } from "../hooks/useChatConversations";
import { useChatConversationDetail } from "../hooks/useChatConversationDetail";
import { useMiraiStatus } from "../hooks/useMirAI";
import { useTtsStatus, useSpeakText } from "../hooks/useTextToSpeech";
import { TtsNowPlayingBar } from "./TtsNowPlayingBar";
import { roleHasPermission, findOwnMember, CHAT_PERMISSIONS } from "../lib/chatPermissions";
import { buildAllAttachments, buildMessagesTranscript } from "../lib/chatUtils";
import { useAuth } from "../../../auth/AuthProvider";
import { useCalls } from "../calls/CallsProvider";
import { ChatHeader } from "./ChatHeader";

// Same pattern as ConversationProfilePanel's backHeader — an explicit,
// always-visible way out of a view that replaces the message list in place.
function ExchangeViewBackHeader({ title, onBack }) {
  return (
    <div className="flex items-center gap-2 px-3 pt-2 pb-1.5 border-b border-[hsl(var(--border))] shrink-0">
      <button
        type="button"
        onClick={onBack}
        title="Volver a mensajes"
        className="h-7 w-7 flex items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors touch-manipulation"
      >
        <ArrowLeft className="h-4 w-4" />
      </button>
      <p className="text-sm font-semibold">{title}</p>
    </div>
  );
}

// ── Helpers for local "delete for me" ─────────────────────────────────────────

function loadHidden(conversationId) {
  try {
    const raw = localStorage.getItem(`runly-chat-hidden-${conversationId}`);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch { return new Set(); }
}

function saveHidden(conversationId, set) {
  try {
    localStorage.setItem(`runly-chat-hidden-${conversationId}`, JSON.stringify([...set]));
  } catch {}
}

// ── Main ChatWindow ───────────────────────────────────────────────────────────

export function ChatWindow({ conversation, onClose, initialFilesView = false, initialJumpMessageId = null, embedded = null, onCollapse = null, variant = "internal", onConversationUpdate = null }) {
  const navigate = useNavigate();
  const { userProfile, session } = useAuth();
  const isExternal = variant === "external";
  const { enabled: callsEnabled, isStarting: callPending, startCall, openRecordingsFor, clearOpenRecordingsRequest } = useCalls();
  const queryClient = useQueryClient();
  const token = session?.access_token;
  const conversationId = conversation?.id;

  const handleCloseExternal = useCallback(async () => {
    if (!conversationId) return;
    await runly.chat.closeExternal(conversationId, token);
    onConversationUpdate?.({ status: "closed" });
    queryClient.invalidateQueries({ queryKey: ["chat-external-inbox"], exact: false });
  }, [conversationId, token, queryClient, onConversationUpdate]);

  // One selector for all message data — internal chat hooks, or the external
  // support path (/chat/external/*). Both return the same shape. onStatusChange
  // keeps the conversation object the parent holds in sync when the status
  // changes from elsewhere (another operator, or this same close action) —
  // otherwise the header/composer below read a stale snapshot until reload.
  const chatData = useChatWindowData(conversationId, variant, {
    onStatusChange: (status) => onConversationUpdate?.({ status }),
  });
  const messagesData = useMemo(() => ({ data: chatData.messages }), [chatData.messages]);
  const { isLoading, hasMore, isLoadingMore, loadMore } = chatData;
  const sendMessage = chatData.sendMessage;
  const markReadMutate = chatData.markRead;
  const deleteMessageMutate = chatData.deleteMessage;
  const deleteAttachmentMutate = chatData.deleteAttachment;
  const deletingAttachmentId = chatData.deletingAttachmentId;
  const isDeletingAttachment = deletingAttachmentId != null;
  const toggleReactionMutate = ({ messageId, emoji, attachmentId }) =>
    chatData.toggleReaction(messageId, emoji, attachmentId);
  const { mutate: pinMutate } = usePinMessage(conversationId);
  const { mutate: archiveMutate } = useArchiveConversation();
  const { mutate: unarchiveMutate } = useUnarchiveConversation();
  const { onlineUsers, sendTyping: presenceSendTyping } = useChatPresence(isExternal ? null : conversationId);
  const sendTyping = isExternal ? chatData.sendTyping : presenceSendTyping;
  const { data: convsData } = useChatConversations();
  const conversations = convsData?.data ?? [];
  // The conversation-list preview only returns a 5-member slice with no
  // role/permission fields — messages.pin gating needs the full member list
  // with roleId/rolePermissions, which only the detail query returns.
  const { data: conversationDetail } = useChatConversationDetail(conversationId);
  const detailMembers = conversationDetail?.data?.members ?? null;
  // messages.send is only meaningful for channel/group (direct/external_support
  // have no roles, so roleHasPermission would just resolve false for them —
  // guard by type instead of relying on that, same as the backend's own gate).
  const isChannelOrGroupType = conversation?.type === "channel" || conversation?.type === "group";
  const isMirai = conversation?.type === "mirai";
  const { data: miraiStatus } = useMiraiStatus();
  const miraiAvailable = !isMirai || miraiStatus?.available !== false;
  // "Leer en voz alta" — one shared instance for this whole chat window, so
  // both the per-message buttons (ChatMessageList) and the persistent "now
  // playing"/"generando audio" bar right under the header stay in sync.
  const { data: ttsStatus } = useTtsStatus();
  const ttsEnabled = Boolean(ttsStatus?.enabled);
  const speech = useSpeakText();
  const ownMemberForComposer = findOwnMember(detailMembers ?? conversation?.members ?? [], userProfile?.id);
  const canSendMessages = !isChannelOrGroupType || roleHasPermission(ownMemberForComposer, CHAT_PERMISSIONS.MESSAGES_SEND);
  // Pinned messages also drive the anchored strip above the message list (not
  // just the header badge / sheet). Same query key as ChatHeader's own call,
  // so React Query serves both from one request.
  const { data: pinnedData } = usePinnedMessages(conversationId, { enabled: isChannelOrGroupType });
  const pinnedMessages = isChannelOrGroupType ? (pinnedData?.data ?? []) : [];
  const canPinMessages = isChannelOrGroupType && roleHasPermission(ownMemberForComposer, CHAT_PERMISSIONS.MESSAGES_PIN);

  const [filesView, setFilesView] = useState(initialFilesView);
  const [recordingsView, setRecordingsView] = useState(false);
  const [hiddenMessageIds, setHiddenMessageIds] = useState(() =>
    conversationId ? loadHidden(conversationId) : new Set(),
  );
  // { messageIds: string[] } while the forward modal is open, else null.
  const [forwardTarget, setForwardTarget] = useState(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedMsgIds, setSelectedMsgIds] = useState(new Set());
  // Separate selection state for the standalone Files view (reached from the
  // header's file icon) — this is a distinct surface from
  // ConversationMediaTab.jsx's own copy of the same pattern (profile panel's
  // Media tab), not shared with it, so each needs its own state.
  const [filesSelectionMode, setFilesSelectionMode] = useState(false);
  const [filesSelectedIds, setFilesSelectedIds] = useState(new Set());
  const [searchMode, setSearchMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [membersView, setMembersView] = useState(false);
  const [profileInitialTab, setProfileInitialTab] = useState(null);
  const [showPinned, setShowPinned] = useState(false);
  const [miraiPanelOpen, setMiraiPanelOpen] = useState(false);
  const [miraiFocus, setMiraiFocus] = useState(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [jumpTarget, setJumpTarget] = useState(null);
  const [threadPanelRootId, setThreadPanelRootId] = useState(null);
  const [replyingTo, setReplyingTo] = useState(null);

  const composerRef = useRef(null);
  const [isDragOver, setIsDragOver] = useState(false);
  // No longer stores its own attachments array — the viewer always renders
  // the conversation-wide allAttachments list below, positioned at whichever
  // index the click resolved to, so it can page through every file in the
  // chat rather than being scoped to one message.
  const [viewer, setViewer] = useState({ open: false, activeIndex: 0 });
  // Every file ever shared in this conversation (real attachments + file-type
  // entity references), oldest first — see buildAllAttachments in
  // chatUtils.js. Opening ANY file inline resolves to its position in THIS
  // list, not a per-message one, so the viewer can page through the whole
  // chat's media.
  const filesHistory = useConversationFiles(conversationId, filesView);
  const allAttachments = useMemo(() => buildAllAttachments(filesView ? (filesHistory.data ?? []) : (messagesData?.data ?? [])), [messagesData, filesView, filesHistory.data]);

  const markReadRef = useRef(markReadMutate);
  markReadRef.current = markReadMutate;

  // Snapshot the unread count the instant this conversation is opened —
  // captured during render (before the markRead effect below fires and its
  // mutation's onSuccess invalidates the conversations list, zeroing this
  // same field out). ChatMessageList uses it to land the initial scroll on
  // the first unread message (WhatsApp-style) instead of the very bottom,
  // and to scope the "@" jump button to mentions that are actually unread.
  const unreadSnapshotRef = useRef({ id: null, count: 0 });
  if (unreadSnapshotRef.current.id !== conversationId) {
    unreadSnapshotRef.current = { id: conversationId, count: conversation?.unread_count ?? 0 };
  }

  // Reset local state when conversation changes
  useEffect(() => {
    setFilesView(initialFilesView);
    setRecordingsView(false);
    setHiddenMessageIds(conversationId ? loadHidden(conversationId) : new Set());
    setSelectionMode(false);
    setSelectedMsgIds(new Set());
    setFilesSelectionMode(false);
    setFilesSelectedIds(new Set());
    setSearchMode(false);
    setSearchQuery("");
    setSearchCurrentIdx(0);
    setMembersView(false);
    setProfileInitialTab(null);
    setShowPinned(false);
    setJumpTarget(null);
    setThreadPanelRootId(null);
    setReplyingTo(null);
  }, [conversationId, initialFilesView]);

  useEffect(() => {
    if (conversationId && token) markReadRef.current();
  }, [conversationId, token]);

  const handleSend = useCallback(
    async (data) => { await sendMessage(data); },
    [sendMessage],
  );

  // Ignores the (attachments, activeIndex) pair's CONTENTS beyond the
  // clicked item's id — that pair is whatever local list the caller had on
  // hand (a message's own attachments, or one message's file-type entity
  // refs), just enough to identify which file was clicked. This always opens
  // the SAME viewer positioned at that file's spot in the conversation-wide
  // allAttachments list, so paging from here walks the whole chat's media.
  const handleAttachmentClick = useCallback((attachments, activeIndex) => {
    const clickedId = attachments?.[activeIndex]?.id;
    const globalIdx = allAttachments.findIndex((f) => f.id === clickedId);
    setViewer({ open: true, activeIndex: globalIdx >= 0 ? globalIdx : 0 });
  }, [allAttachments]);

  function toggleFilesSelect(id) {
    setFilesSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function cancelFilesSelection() {
    setFilesSelectionMode(false);
    setFilesSelectedIds(new Set());
  }

  // Direct sequential downloads — same staggered pattern as
  // ConversationMediaTab.jsx's handleBulkDownload, avoiding Chrome's
  // multi-download permission prompt on a burst of simultaneous downloads.
  function handleFilesBulkDownload() {
    const targets = [];
    for (const msg of filesHistory.data ?? []) {
      for (const att of msg.attachments ?? []) {
        if (filesSelectedIds.has(att.id)) targets.push(att);
      }
    }
    targets.forEach((att, i) => {
      setTimeout(() => {
        if (!att.url) return;
        const a = document.createElement("a");
        a.href = att.url;
        a.download = att.fileName ?? "archivo";
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.click();
      }, i * 150);
    });
    cancelFilesSelection();
  }

  const openProfile = useCallback((tab = null) => {
    setProfileInitialTab(tab);
    setMembersView(true);
    setFilesView(false);
    setRecordingsView(false);
  }, []);

  const closeProfile = useCallback(() => {
    setMembersView(false);
    setProfileInitialTab(null);
  }, []);

  // Files/recordings replace the message list in place, with no other visible
  // way back besides re-finding the same header toggle/dropdown item that
  // opened them — not obvious as a "close" action. An explicit back arrow
  // (same pattern as ConversationProfilePanel's backHeader) fixes that.
  const closeExchangeView = useCallback(() => {
    setFilesView(false);
    setRecordingsView(false);
  }, []);

  const showAllFiles = useCallback(() => {
    setMembersView(false);
    setProfileInitialTab(null);
    setFilesView(true);
  }, []);

  const handleDeleteMessage = useCallback((messageId) => {
    deleteMessageMutate(messageId);
  }, [deleteMessageMutate]);

  const handleDeleteAttachment = useCallback((attachmentId) => {
    deleteAttachmentMutate(attachmentId);
  }, [deleteAttachmentMutate]);

  const handleJumpToMessage = useCallback((messageId, threadRootId) => {
    setShowPinned(false);
    if (threadRootId) {
      setThreadPanelRootId(threadRootId);
      return;
    }
    setFilesView(false);
    setRecordingsView(false);
    setJumpTarget({ id: messageId, nonce: Date.now() });
  }, []);

  // A search result (global, or from another surface) opened this conversation
  // with ?msg=<id> — reuse the same jump path pinned/reply jumps use.
  useEffect(() => {
    if (!initialJumpMessageId || !conversationId) return;
    setFilesView(false);
    setRecordingsView(false);
    setJumpTarget({ id: initialJumpMessageId, nonce: `msg-${initialJumpMessageId}` });
  }, [initialJumpMessageId, conversationId]);

  // A message's "Ver grabación" action bumps CallsProvider's shared signal —
  // open the Grabaciones view in place when it targets THIS conversation.
  useEffect(() => {
    if (openRecordingsFor && openRecordingsFor === conversationId) {
      setRecordingsView(true);
      clearOpenRecordingsRequest();
    }
  }, [openRecordingsFor, conversationId, clearOpenRecordingsRequest]);

  const handleHideForMe = useCallback((messageId) => {
    setHiddenMessageIds((prev) => {
      const next = new Set(prev);
      next.add(messageId);
      if (conversationId) saveHidden(conversationId, next);
      return next;
    });
  }, [conversationId]);

  // Selection handlers
  const enterSelectionMode = useCallback((firstMsgId) => {
    setSelectionMode(true);
    setSelectedMsgIds(new Set(firstMsgId ? [firstMsgId] : []));
  }, []);

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedMsgIds(new Set());
  }, []);

  // Escape closes whichever plain-state overlay is currently on top of the
  // base message view, one layer at a time — selection mode, then search,
  // then the profile panel, then the files view. Dialog/Sheet-based overlays
  // (ForwardMessageModal, PinnedMessagesSheet, ThreadPanel, ConfirmDialog)
  // already close on Escape via Radix's own built-in handling and don't need
  // anything here. When nothing is layered on top, Escape backs out of the
  // conversation itself (onClose) — but a first press only blurs a non-empty
  // composer so a half-typed message isn't lost to a stray keystroke.
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key !== "Escape") return;
      if (selectionMode) { exitSelectionMode(); return; }
      if (searchMode) { setSearchMode(false); setSearchQuery(""); return; }
      if (membersView) { closeProfile(); return; }
      if (filesView) { setFilesView(false); setRecordingsView(false); return; }
      if (!conversation || e.defaultPrevented || !onClose) return;
      // A Radix overlay / the message action menu owns Escape while open.
      if (document.querySelector(
        '[role="dialog"],[role="alertdialog"],[data-radix-popper-content-wrapper],[data-radix-menu-content],[data-msg-action-menu]',
      )) return;
      const ae = document.activeElement;
      const editable = ae && (ae.tagName === "TEXTAREA" || ae.tagName === "INPUT" || ae.isContentEditable);
      if (editable && String(ae.value ?? ae.textContent ?? "").trim()) { ae.blur(); return; }
      onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [selectionMode, searchMode, membersView, filesView, exitSelectionMode, closeProfile, onClose, conversation]);

  const toggleSelectMessage = useCallback((msgId) => {
    setSelectedMsgIds((prev) => {
      const next = new Set(prev);
      if (next.has(msgId)) next.delete(msgId);
      else next.add(msgId);
      return next;
    });
  }, []);

  const handleDeleteSelectedForMe = useCallback(() => {
    setHiddenMessageIds((prev) => {
      const next = new Set(prev);
      for (const id of selectedMsgIds) next.add(id);
      if (conversationId) saveHidden(conversationId, next);
      return next;
    });
    exitSelectionMode();
  }, [selectedMsgIds, conversationId, exitSelectionMode]);

  const handleDeleteSelectedForAll = useCallback(() => {
    const messages = messagesData?.data ?? [];
    for (const id of selectedMsgIds) {
      const msg = messages.find((m) => m.id === id);
      if (msg && msg.sender_user_id === userProfile?.id && !msg.deleted_at) {
        deleteMessageMutate(id);
      }
    }
    // Also hide the rest for me
    const ownIds = new Set(
      messages
        .filter((m) => selectedMsgIds.has(m.id) && m.sender_user_id === userProfile?.id)
        .map((m) => m.id),
    );
    const otherIds = [...selectedMsgIds].filter((id) => !ownIds.has(id));
    if (otherIds.length) {
      setHiddenMessageIds((prev) => {
        const next = new Set(prev);
        for (const id of otherIds) next.add(id);
        if (conversationId) saveHidden(conversationId, next);
        return next;
      });
    }
    exitSelectionMode();
  }, [selectedMsgIds, messagesData, userProfile, deleteMessageMutate, conversationId, exitSelectionMode]);

  const handleDeleteConversation = useCallback(() => {
    const messages = messagesData?.data ?? [];
    setHiddenMessageIds((prev) => {
      const next = new Set(prev);
      for (const m of messages) next.add(m.id);
      if (conversationId) saveHidden(conversationId, next);
      return next;
    });
  }, [messagesData, conversationId]);

  const handleForwardSelected = useCallback(() => {
    // Each selected message is forwarded as its own message (with its own
    // attachments), in conversation order — the API clones attachments and
    // tags metadata.forwardedFrom.
    const ids = (messagesData?.data ?? [])
      .filter((m) => selectedMsgIds.has(m.id) && !m.deleted_at && !String(m.id).startsWith("temp-"))
      .map((m) => m.id);
    if (!ids.length) return;
    setForwardTarget({ messageIds: ids });
    exitSelectionMode();
  }, [messagesData, selectedMsgIds, exitSelectionMode]);

  const handleCopySelected = useCallback(async () => {
    const msgs = (messagesData?.data ?? []).filter(
      (m) => selectedMsgIds.has(m.id) && m.body && !m.deleted_at,
    );
    if (!msgs.length) return;
    const transcript = buildMessagesTranscript(msgs);
    try {
      await navigator.clipboard.writeText(transcript);
      toast.success(msgs.length === 1 ? "Mensaje copiado" : "Mensajes copiados");
    } catch {
      /* clipboard blocked — mirror the single-message copy's silent failure */
    }
    exitSelectionMode();
  }, [messagesData, selectedMsgIds, exitSelectionMode]);

  // "Para todos" only when ALL selected messages are own and non-deleted
  const hasOwnSelected = useMemo(() => {
    if (!selectedMsgIds.size) return false;
    const messages = messagesData?.data ?? [];
    return [...selectedMsgIds].every((id) => {
      const m = messages.find((msg) => msg.id === id);
      return m && m.sender_user_id === userProfile?.id && !m.deleted_at;
    });
  }, [selectedMsgIds, messagesData, userProfile]);

  // In-conversation search now hits the server (pg_trgm fuzzy) so it finds
  // matches anywhere in history, not just the page currently loaded in the
  // client. Ordered newest-match-first for next/prev navigation.
  const {
    orderedHitIds: rawSearchHitIds,
    isSearching: isSearchingServer,
    isError: searchError,
    hasQuery: searchHasQuery,
  } = useChatMessageSearch({
    q: searchQuery,
    conversationId,
    enabled: searchMode,
    limit: 50,
  });

  const searchMatchIds = useMemo(
    () => (searchMode ? rawSearchHitIds.filter((id) => !hiddenMessageIds.has(id)) : []),
    [searchMode, rawSearchHitIds, hiddenMessageIds],
  );

  const [searchCurrentIdx, setSearchCurrentIdx] = useState(0);

  useEffect(() => { setSearchCurrentIdx(0); }, [searchQuery]);

  const currentMatchId = searchMatchIds[searchCurrentIdx] ?? null;

  // The current match may live in history that isn't paged in yet — drive the
  // same loader the pinned/reply jump uses. ChatMessageList flashes it on
  // arrival; searchMatchIds styles it once loaded.
  useEffect(() => {
    if (!searchMode || !currentMatchId) return;
    setJumpTarget({ id: currentMatchId, nonce: `search-${currentMatchId}-${searchCurrentIdx}` });
  }, [searchMode, currentMatchId, searchCurrentIdx]);

  const handleNextMatch = useCallback(() => {
    if (!searchMatchIds.length) return;
    setSearchCurrentIdx((i) => (i + 1) % searchMatchIds.length);
  }, [searchMatchIds]);

  const handlePrevMatch = useCallback(() => {
    if (!searchMatchIds.length) return;
    setSearchCurrentIdx((i) => (i - 1 + searchMatchIds.length) % searchMatchIds.length);
  }, [searchMatchIds]);

  function handleDragOver(e) {
    e.preventDefault();
    setIsDragOver(true);
  }

  function handleDragLeave(e) {
    if (!e.currentTarget.contains(e.relatedTarget)) setIsDragOver(false);
  }

  function handleDrop(e) {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) composerRef.current?.addFiles(files);
  }

  if (!conversation) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="mx-auto h-14 w-14 rounded-2xl bg-[hsl(var(--muted))] flex items-center justify-center">
            <MessageSquare className="h-7 w-7 text-[hsl(var(--primary)/0.4)]" />
          </div>
          <div className="space-y-0.5">
            <p className="text-sm font-medium text-[hsl(var(--foreground))]">Selecciona una conversacion</p>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">para empezar a chatear</p>
          </div>
        </div>
      </div>
    );
  }

  const messages = messagesData?.data ?? [];

  return (
    <div
      className="relative flex w-full min-w-0 max-w-full flex-1 overflow-hidden min-h-0"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragOver && <DropZoneOverlay rounded="rounded-none" />}

      {/* Header + message body + composer all live in ONE column now, so the
          profile sidebar (below) sits alongside the WHOLE chat — header
          included — instead of being nested inside just the message-body
          row below a second, separate header. That nesting used to leave
          ConversationProfilePanel's own header stacked under ChatHeader
          instead of flush with the top of the window, and left the composer
          spanning full width underneath the sidebar instead of stopping at
          this column's edge. */}
      <div className={[
        "w-full min-w-0 max-w-full min-h-0 flex-col overflow-hidden",
        membersView ? "hidden xl:flex xl:flex-1" : "flex flex-1",
      ].join(" ")}>
      <ChatHeader
        conversation={conversation}
        currentUserId={userProfile?.id}
        onlineUsers={onlineUsers}
        detailMembers={detailMembers}
        onClose={onClose}
        embedded={embedded}
        onCollapse={onCollapse}
        variant={variant}
        externalStatus={conversation?.status ?? null}
        onCloseExternal={isExternal ? handleCloseExternal : undefined}
        filesView={filesView}
        onToggleFilesView={() => { setFilesView((v) => !v); setRecordingsView(false); setMembersView(false); setProfileInitialTab(null); }}
        onToggleRecordingsView={() => { setRecordingsView((v) => !v); setFilesView(false); setMembersView(false); }}
        searchMode={searchMode}
        searchQuery={searchQuery}
        onSearchToggle={() => { setSearchMode((v) => !v); setSearchQuery(""); setSearchCurrentIdx(0); }}
        onSearchChange={setSearchQuery}
        searchMatchCount={searchMatchIds.length}
        searchCurrentIdx={searchCurrentIdx}
        searchBusy={isSearchingServer}
        searchError={searchError}
        searchHasQuery={searchHasQuery}
        onNextMatch={handleNextMatch}
        onPrevMatch={handlePrevMatch}
        selectionMode={selectionMode}
        selectionCount={selectedMsgIds.size}
        hasOwnSelected={hasOwnSelected}
        onSelectionCancel={exitSelectionMode}
        onDeleteForMe={handleDeleteSelectedForMe}
        onDeleteForAll={handleDeleteSelectedForAll}
        onForwardSelected={handleForwardSelected}
        onCopySelected={handleCopySelected}
        onEnterSelection={() => enterSelectionMode(null)}
        onDeleteConversation={handleDeleteConversation}
        onOpenProfile={openProfile}
        onOpenPinned={() => setShowPinned(true)}
        isMirai={isMirai}
        onOpenMirai={isExternal ? undefined : () => { setMiraiFocus(null); setMiraiPanelOpen(true); }}
        miraiDisabled={miraiStatus?.available === false}
        callsEnabled={isExternal ? false : callsEnabled}
        callPending={callPending}
        onStartAudioCall={() => startCall({ conversationId, kind: "AUDIO" })}
        onStartVideoCall={() => startCall({ conversationId, kind: "VIDEO" })}
        onOpenGuestLink={!isExternal && callsEnabled ? () => setShareOpen(true) : undefined}
        isArchived={conversation?.is_archived ?? false}
        onArchive={!isExternal && conversationId
          ? () => conversation?.is_archived
            ? unarchiveMutate(conversationId)
            : archiveMutate(conversationId)
          : undefined}
      />

      <TtsNowPlayingBar speech={speech} />

      <div className="flex-1 min-w-0 min-h-0 flex flex-col">
          {recordingsView ? (
            <div className="flex-1 min-h-0 flex flex-col">
              <ExchangeViewBackHeader title="Grabaciones" onBack={closeExchangeView} />
              <ChatRecordingsGallery conversationId={conversationId} />
            </div>
          ) : filesView ? (
            <div className="flex-1 min-h-0 flex flex-col">
              <ExchangeViewBackHeader title="Archivos" onBack={closeExchangeView} />
              {filesHistory.isError && <ErrorState title="No se pudieron cargar los archivos" onRetry={filesHistory.refetch} />}
              <ChatFilesGallery
                messages={filesHistory.data ?? []}
                isLoading={filesHistory.isLoading}
                onAttachmentClick={handleAttachmentClick}
                selectionMode={filesSelectionMode}
                selectedIds={filesSelectedIds}
                onToggleSelect={toggleFilesSelect}
                onEnterSelection={() => setFilesSelectionMode(true)}
                onCancelSelection={cancelFilesSelection}
              />
              {filesSelectionMode && filesSelectedIds.size > 0 && (
                <div className="shrink-0 px-4 py-2.5 border-t border-[hsl(var(--border))] bg-[hsl(var(--card))] flex items-center justify-between">
                  <span className="text-xs text-[hsl(var(--muted-foreground))]">
                    {filesSelectedIds.size} {filesSelectedIds.size === 1 ? "archivo" : "archivos"}
                  </span>
                  <button
                    type="button"
                    onClick={handleFilesBulkDownload}
                    className="text-xs font-medium px-3 py-1.5 rounded-full bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:opacity-90 transition-opacity"
                  >
                    Descargar ({filesSelectedIds.size})
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
            {isMirai && !isLoading && (messages?.length ?? 0) <= 1 && (
              <MirAIIntro onPickPrompt={(text) => composerRef.current?.prefill?.(text)} />
            )}
            <ChatMessageList
              key={conversationId}
              messages={messages}
              isLoading={isLoading}
              ttsEnabled={ttsEnabled}
              speech={speech}
              currentUserId={userProfile?.id}
              typingUsers={chatData.typingUsers}
              onAttachmentClick={handleAttachmentClick}
              members={detailMembers ?? conversation.members}
              conversationType={conversation?.type}
              hasMore={hasMore}
              isLoadingMore={isLoadingMore}
              onLoadMore={loadMore}
              onDeleteMessage={handleDeleteMessage}
              onDeleteAttachment={handleDeleteAttachment}
              deletingAttachmentId={isDeletingAttachment ? deletingAttachmentId : null}
              onHideForMe={handleHideForMe}
              onForward={(m) => setForwardTarget({ messageIds: [m.id] })}
              onPinMessage={(messageId, pinned) => pinMutate({ messageId, pinned })}
              onToggleReaction={(messageId, emoji, attachmentId) => toggleReactionMutate({ messageId, emoji, attachmentId })}
              onOpenThread={(messageId) => setThreadPanelRootId(messageId)}
              onReplyToMessage={(msg) => setReplyingTo(msg)}
              onAskMirai={
                isMirai || conversation?.type === "external_support" || miraiStatus?.available === false
                  ? undefined
                  : (msg) => { setMiraiFocus(msg); setMiraiPanelOpen(true); }
              }
              onJumpToMessage={(id) => setJumpTarget({ id, nonce: Date.now() })}
              onJumpFailed={() =>
                toast.message(
                  searchMode || initialJumpMessageId
                    ? "Mostrando la conversacion; el mensaje puede estar mas atras en el historial."
                    : "No se pudo cargar el mensaje original.",
                )
              }
              onJumpToThread={(threadRootId) => {
                setThreadPanelRootId(threadRootId);
                toast.message("El mensaje esta en un hilo; abrimos el hilo.");
              }}
              hiddenMessageIds={hiddenMessageIds}
              selectionMode={selectionMode}
              selectedMsgIds={selectedMsgIds}
              onToggleSelect={toggleSelectMessage}
              onEnterSelection={enterSelectionMode}
              searchQuery={searchMode && searchHasQuery ? searchQuery : ""}
              searchMatchIds={searchMode && searchMatchIds.length ? new Set(searchMatchIds) : null}
              currentMatchId={currentMatchId}
              scrollToMessage={jumpTarget}
              unreadCountAtOpen={unreadSnapshotRef.current.count}
              pinnedMessages={pinnedMessages}
              onOpenPinnedList={() => setShowPinned(true)}
              onJumpToPinnedMessage={handleJumpToMessage}
              onUnpinMessage={(id) => pinMutate({ messageId: id, pinned: false })}
              canUnpinMessages={canPinMessages}
            />
            </>
          )}
      </div>

      {/* Below xl: the profile sidebar fully replaces this whole column (no
          room for both) — the column div's own "hidden xl:flex" above
          handles that. At xl and up this column stays visible alongside the
          sidebar (see below), composer included, so you can keep chatting
          while looking at the profile. */}
      {!filesView && isExternal && conversation?.status !== "closed" && (
        <div className="shrink-0">
          <div className="flex items-center gap-2 px-3 pt-2">
            <ChatTemplatePopover
              onSelect={(body) => composerRef.current?.setBody?.(body)}
              vars={{
                nombre_agente: userProfile?.displayName ?? userProfile?.email ?? "Agente",
                nombre_cliente: conversation?.guest_name ?? conversation?.guest_email ?? "Cliente",
                email_cliente: conversation?.guest_email ?? "",
              }}
            />
            <span className="text-[10px] text-[hsl(var(--muted-foreground))]">Plantillas</span>
          </div>
          <MessageComposer
            ref={composerRef}
            onSend={handleSend}
            onTyping={sendTyping}
            placeholder="Responder al visitante..."
            conversationId={conversationId}
            conversationType="external_support"
            replyingTo={replyingTo}
            onCancelReply={() => setReplyingTo(null)}
            dropZoneDisabled
            edgeInset
          />
        </div>
      )}

      {!filesView && isExternal && conversation?.status === "closed" && (
        <div className="shrink-0 border-t border-[hsl(var(--border))] px-4 py-3 text-center text-xs text-[hsl(var(--muted-foreground))]">
          Esta conversacion fue cerrada.
        </div>
      )}

      {!filesView && !isExternal && (
        <MessageComposer
          ref={composerRef}
          onSend={handleSend}
          onTyping={sendTyping}
          placeholder={
            isMirai && !miraiAvailable
              ? "MirAI no está configurado en este entorno"
              : isMirai
                ? "Escribe a MirAI..."
                : canSendMessages
                  ? "Escribe un mensaje..."
                  : "Solo un administrador puede escribir en este canal"
          }
          conversationId={conversationId}
          conversationType={conversation?.type}
          replyingTo={replyingTo}
          onCancelReply={() => setReplyingTo(null)}
          dropZoneDisabled
          edgeInset
          disabled={!canSendMessages || !miraiAvailable}
        />
      )}
      </div>

      {/* True full-height sidebar, alongside the whole chat column above —
          header included — not nested inside just the message-body row. */}
      {membersView && (
        <div className="w-full xl:w-96 xl:shrink-0 xl:border-l xl:border-[hsl(var(--border))] flex flex-col min-h-0 min-w-0">
          <ConversationProfilePanel
            key={profileInitialTab ?? "default"}
            conversation={conversation}
            currentUserId={userProfile?.id}
            initialTab={profileInitialTab}
            onBack={closeProfile}
            messages={messages}
            isLoadingMessages={isLoading}
            onShowAllFiles={showAllFiles}
            onOpenConversation={(conv) => navigate(`/app/m/runly.chat/chat/inbox/${conv.id}`)}
            onDeleted={onClose}
            callsEnabled={callsEnabled}
            callPending={callPending}
            onStartAudioCall={() => startCall({ conversationId, kind: "AUDIO" })}
            onStartVideoCall={() => startCall({ conversationId, kind: "VIDEO" })}
          />
        </div>
      )}

      <ChatAttachmentViewer
        open={viewer.open}
        onOpenChange={(open) => setViewer((v) => ({ ...v, open }))}
        attachments={allAttachments}
        activeIndex={viewer.activeIndex}
        onIndexChange={(i) => setViewer((v) => ({ ...v, activeIndex: i }))}
      />

      <ForwardMessageModal
        open={Boolean(forwardTarget)}
        onClose={() => setForwardTarget(null)}
        messageIds={forwardTarget?.messageIds ?? []}
        sourceMessages={
          forwardTarget
            ? (messages ?? []).filter((m) => forwardTarget.messageIds.includes(m.id))
            : []
        }
        conversations={conversations}
      />

      {!isExternal && (
        <CallShareDialog
          open={shareOpen}
          onOpenChange={setShareOpen}
          conversationId={conversationId}
        />
      )}

      <PinnedMessagesSheet
        open={showPinned}
        onOpenChange={setShowPinned}
        conversationId={conversationId}
        currentUserId={userProfile?.id}
        members={detailMembers ?? conversation.members}
        onJumpToMessage={handleJumpToMessage}
      />

      <ThreadPanel
        open={Boolean(threadPanelRootId)}
        onOpenChange={(open) => { if (!open) setThreadPanelRootId(null); }}
        rootMessageId={threadPanelRootId}
        conversationId={conversationId}
        conversationType={conversation?.type}
        members={detailMembers ?? conversation.members}
        onToggleReaction={(messageId, emoji, attachmentId) => toggleReactionMutate({ messageId, emoji, attachmentId })}
      />

      {!isMirai && conversation?.type !== "external_support" && (
        <MirAIPanel
          open={miraiPanelOpen}
          onOpenChange={(o) => { setMiraiPanelOpen(o); if (!o) setMiraiFocus(null); }}
          conversationId={conversationId}
          focusMessage={miraiFocus}
        />
      )}
    </div>
  );
}
