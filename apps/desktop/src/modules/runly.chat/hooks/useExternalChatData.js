import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../../auth/AuthProvider";
import { runly } from "../../../lib/runly";
import { subscribeToMultiBroadcast } from "../lib/supabaseRealtime";
import { mergeExternalPages } from "../lib/mergeExternalPages";
import { useToggleReaction } from "./useChatMessages";

export { mergeExternalPages };

// Operator-side data for ChatWindow when it renders an `external_support`
// conversation. Returns the same shape as useChatWindowData's internal branch,
// backed by the /chat/external/* endpoints and the chat:conv:* broadcast
// channel the guest widget also publishes to.
export function useExternalChatData(conversationId, { enabled = true, onStatusChange = null } = {}) {
  const { session } = useAuth();
  const token = session?.access_token;
  const queryClient = useQueryClient();
  const on = Boolean(enabled && token && conversationId);

  const [olderMessages, setOlderMessages] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [guestTyping, setGuestTyping] = useState(false);
  const [guestLastReadAt, setGuestLastReadAt] = useState(null);
  const typingClearRef = useRef(null);
  const initedRef = useRef(false);

  const query = useQuery({
    queryKey: ["chat-external-messages", conversationId],
    queryFn: () => runly.chat.listExternalMessages(conversationId, { limit: 40 }, token),
    enabled: on,
    staleTime: 10_000,
    refetchInterval: 45_000,
  });

  useEffect(() => {
    initedRef.current = false;
    setOlderMessages([]);
    setHasMore(false);
    setIsLoadingMore(false);
    setGuestTyping(false);
    setGuestLastReadAt(null);
  }, [conversationId]);

  useEffect(() => {
    if (query.data && !initedRef.current) {
      initedRef.current = true;
      setHasMore(query.data.hasMore ?? false);
    }
  }, [query.data]);

  const loadMore = useCallback(async () => {
    if (isLoadingMore || !hasMore || !on) return;
    const latest = queryClient.getQueryData(["chat-external-messages", conversationId])?.data ?? [];
    const oldest = olderMessages[0] ?? latest[0];
    if (!oldest?.created_at) return;
    setIsLoadingMore(true);
    try {
      const res = await runly.chat.listExternalMessages(
        conversationId,
        { limit: 40, before: oldest.created_at },
        token,
      );
      const newOlder = res?.data ?? [];
      setOlderMessages((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        return [...newOlder.filter((m) => !seen.has(m.id)), ...prev];
      });
      setHasMore(res?.hasMore ?? false);
    } finally {
      setIsLoadingMore(false);
    }
  }, [isLoadingMore, hasMore, on, conversationId, olderMessages, token, queryClient]);

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["chat-external-messages", conversationId] });
    queryClient.invalidateQueries({ queryKey: ["chat-external-inbox"], exact: false });
  }, [queryClient, conversationId]);

  useEffect(() => {
    if (!on) return;
    const unsub = subscribeToMultiBroadcast(`chat:conv:${conversationId}`, {
      new_guest_message: invalidate,
      new_operator_message: invalidate,
      guest_typing: () => {
        setGuestTyping(true);
        clearTimeout(typingClearRef.current);
        typingClearRef.current = setTimeout(() => setGuestTyping(false), 4000);
      },
      guest_read: (msg) => setGuestLastReadAt(msg?.payload?.at ?? new Date().toISOString()),
      conversation_closed: () => {
        invalidate();
        onStatusChange?.("closed");
      },
    });
    return () => {
      unsub?.();
      clearTimeout(typingClearRef.current);
    };
  }, [on, conversationId, invalidate, onStatusChange]);

  const sendMut = useMutation({
    mutationFn: (data) => runly.chat.sendExternalMessage(conversationId, data, token),
    onSuccess: invalidate,
  });
  const deleteMut = useMutation({
    mutationFn: (messageId) => runly.chat.deleteExternalMessage(conversationId, messageId, token),
    onSuccess: invalidate,
  });
  const { mutate: toggleReactionMutate } = useToggleReaction(conversationId);

  const latestMessages = query.data?.data ?? [];
  const messages = useMemo(
    () => mergeExternalPages(olderMessages, latestMessages),
    [olderMessages, latestMessages],
  );

  return {
    messages,
    isLoading: query.isLoading,
    hasMore,
    isLoadingMore,
    loadMore,
    sendMessage: (data) => sendMut.mutateAsync(data),
    markRead: () => runly.chat.markExternalRead(conversationId, token).catch(() => {}),
    deleteMessage: (id) => deleteMut.mutate(id),
    deleteAttachment: () => {},
    deletingAttachmentId: null,
    toggleReaction: (messageId, emoji, attachmentId) =>
      toggleReactionMutate({ messageId, emoji, attachmentId }),
    typingUsers: guestTyping ? [{ id: "guest", name: "El visitante" }] : [],
    guestLastReadAt,
    sendTyping: () => runly.chat.sendExternalTyping(conversationId, token).catch(() => {}),
  };
}
