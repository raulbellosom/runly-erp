import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef, useCallback, useState, useMemo } from "react";
import { useAuth } from "../../../auth/AuthProvider";
import { runly } from "../../../lib/runly";
import { subscribeToMessages } from "../lib/supabaseRealtime";
import { useRealtimeContext } from "../../../providers/RealtimeProvider";

export function useChatMessages(conversationId) {
  const { session } = useAuth();
  const token = session?.access_token;
  const queryClient = useQueryClient();
  const unsubRef = useRef(null);
  const { on } = useRealtimeContext();

  // Older pages accumulated via "load more" — stored separately from the latest page
  const [olderMessages, setOlderMessages] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const hasInitialized = useRef(false);

  const query = useQuery({
    queryKey: ["chat-messages", conversationId],
    queryFn: () => runly.chat.listMessages(conversationId, { limit: 40 }, token),
    enabled: Boolean(token && conversationId),
    staleTime: 5_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  // Initialize hasMore from the first successful fetch of this conversation
  useEffect(() => {
    if (query.data && !hasInitialized.current) {
      hasInitialized.current = true;
      setHasMore(query.data.hasMore ?? false);
    }
  }, [query.data]);

  // Reset older pages and hasMore when conversation changes
  useEffect(() => {
    hasInitialized.current = false;
    setOlderMessages([]);
    setHasMore(false);
    setIsLoadingMore(false);
  }, [conversationId]);

  const loadMore = useCallback(async () => {
    if (isLoadingMore || !hasMore || !token || !conversationId) return;

    // The oldest message is the first in the combined list (olderMessages are prepended)
    const latestData = queryClient.getQueryData(["chat-messages", conversationId])?.data ?? [];
    const oldestMsg = olderMessages.length > 0 ? olderMessages[0] : latestData[0];
    if (!oldestMsg?.created_at) return;

    setIsLoadingMore(true);
    try {
      const result = await runly.chat.listMessages(conversationId, {
        limit: 40,
        before: oldestMsg.created_at,
      }, token);

      const newOlder = result?.data ?? [];
      setOlderMessages((prev) => {
        const existingIds = new Set(prev.map((m) => m.id));
        return [...newOlder.filter((m) => !existingIds.has(m.id)), ...prev];
      });
      setHasMore(result?.hasMore ?? false);
    } catch (err) {
      console.error("[chat] loadMore failed", err);
    } finally {
      setIsLoadingMore(false);
    }
  }, [isLoadingMore, hasMore, token, conversationId, olderMessages, queryClient]);

  const addMessageToCache = useCallback(
    (newMsg) => {
      queryClient.setQueryData(["chat-messages", conversationId], (old) => {
        if (!old) return old;
        const already = old.data?.some((m) => m.id === newMsg.id);
        if (already) return old;
        const filtered = (old.data ?? []).filter(
          (m) => !(m._pending && m.body === newMsg.body && m.message_type === newMsg.message_type),
        );
        return { ...old, data: [...filtered, newMsg] };
      });
      queryClient.invalidateQueries({ queryKey: ["chat-conversations"] });
      if (Number(newMsg.attachment_count) > 0) {
        queryClient.invalidateQueries({ queryKey: ["chat-messages", conversationId] });
      }
    },
    [conversationId, queryClient],
  );

  const updateMessageInCache = useCallback(
    (updatedMsg) => {
      queryClient.setQueryData(["chat-messages", conversationId], (old) => {
        if (!old) return old;
        return {
          ...old,
          data: (old.data ?? []).map((m) =>
            m.id === updatedMsg.id ? { ...m, ...updatedMsg } : m,
          ),
        };
      });
    },
    [conversationId, queryClient],
  );

  const messageHandlerRef = useRef(null);
  useLayoutEffect(() => {
    messageHandlerRef.current = (payload) => {
      if (payload.eventType === "INSERT") addMessageToCache(payload.new);
      else if (payload.eventType === "UPDATE") updateMessageInCache(payload.new);
    };
  });

  useEffect(() => {
    if (!conversationId) return;
    unsubRef.current = subscribeToMessages(conversationId, (payload) => {
      messageHandlerRef.current?.(payload);
    });
    return () => { unsubRef.current?.(); };
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId) return;
    return on("chat.message.new", ({ conversationId: cid }) => {
      if (cid === conversationId) {
        // Full refetch — this also pulls the server-resolved `reply_to`
        // preview for any quoted reply in the incoming message, so the
        // broadcast payload's raw `replyToMessageId` needs no handling here.
        queryClient.invalidateQueries({ queryKey: ["chat-messages", conversationId] });
      }
    });
  }, [conversationId, on, queryClient]);

  useEffect(() => {
    if (!conversationId) return;
    function handleVisibility() {
      if (document.visibilityState === "visible") {
        queryClient.invalidateQueries({ queryKey: ["chat-messages", conversationId] });
        queryClient.invalidateQueries({ queryKey: ["chat-conversations"] });
      }
    }
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [conversationId, queryClient]);

  useEffect(() => {
    if (!conversationId || !token) return;
    runly.notifications.markReadBySource(token, "chat_conversation", conversationId).catch(() => {});
    queryClient.invalidateQueries({ queryKey: ["notifications"] });
  }, [conversationId, token, queryClient]);

  // Combine older pages with the latest page, deduplicating by id
  const latestMessages = query.data?.data ?? [];
  const combinedData = useMemo(() => {
    if (!olderMessages.length) return latestMessages;
    const seen = new Set(olderMessages.map((m) => m.id));
    return [...olderMessages, ...latestMessages.filter((m) => !seen.has(m.id))];
  }, [olderMessages, latestMessages]);

  return {
    ...query,
    data: query.data ? { ...query.data, data: combinedData } : query.data,
    hasMore,
    isLoadingMore,
    loadMore,
  };
}

export function useSendMessage(conversationId) {
  const { session, userProfile } = useAuth();
  const token = session?.access_token;
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => runly.chat.sendMessage(conversationId, data, token),

    onMutate: async (data) => {
      await queryClient.cancelQueries({ queryKey: ["chat-messages", conversationId] });
      const previous = queryClient.getQueryData(["chat-messages", conversationId]);

      // Build the quoted-reply preview client-side from the known original so
      // the quote shows instantly; the server value replaces it on refetch.
      let optimisticReplyTo = null;
      if (data.replyToMessageId) {
        const cache = queryClient.getQueryData(["chat-messages", conversationId]);
        const orig = (cache?.data ?? []).find((m) => m.id === data.replyToMessageId);
        if (orig) {
          const b = (orig.body ?? "").trim();
          const mime = orig.attachments?.[0]?.mimeType ?? "";
          optimisticReplyTo = {
            id: orig.id,
            senderUserId: orig.sender_user_id ?? orig.sender?.id ?? null,
            senderName: orig.sender?.displayName ?? "Usuario",
            bodyPreview: b ? (b.length > 120 ? b.slice(0, 120) : b) : null,
            kind: b ? "text"
              : mime.startsWith("image/") ? "image"
              : mime.startsWith("video/") ? "video"
              : mime.startsWith("audio/") ? "audio"
              : orig.attachments?.length ? "file"
              : Array.isArray(orig.metadata?.entityRefs) && orig.metadata.entityRefs.length ? "entity"
              : "text",
            isDeleted: Boolean(orig.deleted_at),
          };
        }
      }

      const tempId = `temp-${Date.now()}-${Math.random()}`;
      const optimisticAttachments = (data.optimisticAttachments ?? []).filter((a) => a && (a.url || a.fileName));
      const optimistic = {
        id: tempId,
        conversation_id: conversationId,
        sender_user_id: userProfile?.id,
        sender_type: "user",
        body: data.body ?? null,
        message_type: data.messageType ?? "text",
        attachment_count: data.attachmentIds?.length ?? optimisticAttachments.length ?? 0,
        metadata: {},
        created_at: new Date().toISOString(),
        edited_at: null,
        deleted_at: null,
        sender: {
          id: userProfile?.id,
          displayName: userProfile?.displayName ?? null,
          avatarUrl: userProfile?.avatarUrl ?? null,
        },
        // Local blob previews so the pending bubble shows/opens what's being
        // sent; replaced by real signed-URL attachments on refetch.
        attachments: optimisticAttachments.length ? optimisticAttachments : null,
        reply_to: optimisticReplyTo,
        _pending: true,
      };

      queryClient.setQueryData(["chat-messages", conversationId], (old) => {
        if (!old) return old;
        return { ...old, data: [...(old.data ?? []), optimistic] };
      });

      return { previous, tempId };
    },

    onError: (_err, _data, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["chat-messages", conversationId], context.previous);
      }
    },

    onSuccess: (result, _data, context) => {
      const real = result?.data;
      queryClient.setQueryData(["chat-messages", conversationId], (old) => {
        if (!old) return old;
        const withoutTemp = (old.data ?? []).filter((m) => m.id !== context.tempId);
        if (!real) return { ...old, data: withoutTemp };
        const already = withoutTemp.some((m) => m.id === real.id);
        if (already) {
          return { ...old, data: withoutTemp.map((m) => (m.id === real.id ? { ...m, ...real } : m)) };
        }
        return { ...old, data: [...withoutTemp, real] };
      });
      queryClient.invalidateQueries({ queryKey: ["chat-conversations"] });
      queryClient.invalidateQueries({ queryKey: ["chat-messages", conversationId] });
    },
  });
}

export function useMarkRead(conversationId) {
  const { session } = useAuth();
  const token = session?.access_token;
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => runly.chat.markRead(conversationId, token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat-conversations"] });
    },
  });
}

export function useDeleteMessage(conversationId) {
  const { session } = useAuth();
  const token = session?.access_token;
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (messageId) => runly.chat.deleteMessage(messageId, token),
    onMutate: async (messageId) => {
      await queryClient.cancelQueries({ queryKey: ["chat-messages", conversationId] });
      const previous = queryClient.getQueryData(["chat-messages", conversationId]);
      queryClient.setQueryData(["chat-messages", conversationId], (old) => {
        if (!old) return old;
        return {
          ...old,
          data: (old.data ?? []).map((m) =>
            m.id === messageId
              ? { ...m, deleted_at: new Date().toISOString(), body: "" }
              : m,
          ),
        };
      });
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["chat-messages", conversationId], context.previous);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat-messages", conversationId] });
    },
  });
}

export function useEditMessage(conversationId) {
  const { session } = useAuth();
  const token = session?.access_token;
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ messageId, body }) => runly.chat.editMessage(messageId, { body }, token),
    onMutate: async ({ messageId, body }) => {
      await queryClient.cancelQueries({ queryKey: ["chat-messages", conversationId] });
      const previous = queryClient.getQueryData(["chat-messages", conversationId]);
      queryClient.setQueryData(["chat-messages", conversationId], (old) => {
        if (!old) return old;
        return {
          ...old,
          data: (old.data ?? []).map((m) =>
            m.id === messageId
              ? { ...m, body, edited_at: new Date().toISOString() }
              : m,
          ),
        };
      });
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["chat-messages", conversationId], context.previous);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat-messages", conversationId] });
    },
  });
}

export function usePinMessage(conversationId) {
  const { session } = useAuth();
  const token = session?.access_token;
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ messageId, pinned }) => runly.chat.pinMessage(messageId, pinned, token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat-messages", conversationId] });
      queryClient.invalidateQueries({ queryKey: ["chat-pinned-messages", conversationId] });
    },
  });
}

export function useToggleReaction(conversationId) {
  const { session } = useAuth();
  const token = session?.access_token;
  const queryClient = useQueryClient();

  return useMutation({
    // attachmentId omitted/null = message-level reaction (unchanged).
    mutationFn: ({ messageId, emoji, attachmentId = null }) =>
      runly.chat.toggleReaction(messageId, emoji, token, { attachmentId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat-messages", conversationId] });
    },
  });
}

export function useDeleteAttachment(conversationId) {
  const { session } = useAuth();
  const token = session?.access_token;
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (attachmentId) => runly.chat.deleteAttachment(attachmentId, token),
    onSuccess: () => {
      // No optimistic update here (unlike useDeleteMessage): removing one
      // attachment out of a message's array in the cache correctly, without
      // also touching attachment_count / re-deriving whether the whole
      // message got soft-deleted (messageDeleted in the response), is more
      // bookkeeping than a straight refetch is worth for an action a user
      // takes rarely and expects to see settle in under a second either way.
      queryClient.invalidateQueries({ queryKey: ["chat-messages", conversationId] });
    },
  });
}
