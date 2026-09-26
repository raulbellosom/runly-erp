import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";
import { toast } from "sonner";
import { useAuth } from "../../../auth/AuthProvider";
import { runly } from "../../../lib/runly";
import { useRealtimeContext } from "../../../providers/RealtimeProvider";
import { useMuteConversation } from "./useChatModeration";

export function useChatConversations() {
  const { session } = useAuth();
  const token = session?.access_token;
  const queryClient = useQueryClient();
  const { on } = useRealtimeContext();

  const query = useQuery({
    queryKey: ["chat-conversations"],
    queryFn: () => runly.chat.listConversations({}, token),
    enabled: Boolean(token),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    const unsub1 = on("chat.conversation.new", () => {
      queryClient.invalidateQueries({ queryKey: ["chat-conversations"] });
    });
    const unsub2 = on("chat.message.new", () => {
      queryClient.invalidateQueries({ queryKey: ["chat-conversations"] });
    });
    const unsub3 = on("chat.conversation.deleted", () => {
      queryClient.invalidateQueries({ queryKey: ["chat-conversations"] });
    });
    return () => {
      unsub1();
      unsub2();
      unsub3();
    };
  }, [on, queryClient]);

  return query;
}

// Total unread chat messages across every conversation, for a topbar badge —
// muted conversations are excluded (same "don't bug me" contract mute already
// has everywhere else in the chat UI). Reuses useChatConversations' own
// query/cache, so mounting this in the topbar (which is always mounted,
// unlike ChatScreen) doesn't add a second independent fetch — TanStack Query
// dedupes by queryKey, and this becomes the thing that keeps the list warm
// even when the user never opens the chat module.
export function useChatUnreadCount() {
  const { data } = useChatConversations();
  const conversations = data?.data ?? [];
  return conversations.reduce(
    (sum, c) => (c.is_muted ? sum : sum + (c.unread_count ?? 0)),
    0,
  );
}

export function useArchivedConversations({ enabled = true } = {}) {
  const { session } = useAuth();
  const token = session?.access_token;

  return useQuery({
    queryKey: ["chat-conversations-archived"],
    queryFn: () => runly.chat.listConversations({ archived: true }, token),
    enabled: Boolean(token && enabled),
    staleTime: 60_000,
  });
}

export function useArchiveConversation() {
  const { session } = useAuth();
  const token = session?.access_token;
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (conversationId) => runly.chat.archiveConversation(conversationId, token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat-conversations"] });
      queryClient.invalidateQueries({ queryKey: ["chat-conversations-archived"] });
    },
  });
}

export function useUnarchiveConversation() {
  const { session } = useAuth();
  const token = session?.access_token;
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (conversationId) => runly.chat.unarchiveConversation(conversationId, token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat-conversations"] });
      queryClient.invalidateQueries({ queryKey: ["chat-conversations-archived"] });
    },
  });
}

const ACTIVE_KEY = ["chat-conversations"];
const ARCHIVED_KEY = ["chat-conversations-archived"];

// Shared optimistic helper: patch (or drop) a conversation row inside every
// cached list query, remembering the prior snapshots for rollback.
function patchConversationInCaches(queryClient, conversationId, patch) {
  const snapshots = [];
  for (const key of [ACTIVE_KEY, ARCHIVED_KEY]) {
    const prev = queryClient.getQueryData(key);
    if (!prev?.data) continue;
    snapshots.push([key, prev]);
    const next = patch === null
      ? prev.data.filter((c) => c.id !== conversationId)
      : prev.data.map((c) => (c.id === conversationId ? { ...c, ...patch } : c));
    queryClient.setQueryData(key, { ...prev, data: next });
  }
  return snapshots;
}

function restoreSnapshots(queryClient, snapshots) {
  for (const [key, value] of snapshots ?? []) queryClient.setQueryData(key, value);
}

export function usePinConversation() {
  const { session } = useAuth();
  const token = session?.access_token;
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ conversationId, pinned }) => runly.chat.pinConversation(conversationId, pinned, token),
    onMutate: async ({ conversationId, pinned }) => {
      await queryClient.cancelQueries({ queryKey: ACTIVE_KEY });
      return { snapshots: patchConversationInCaches(queryClient, conversationId, { is_pinned: pinned }) };
    },
    onError: (_e, _v, ctx) => restoreSnapshots(queryClient, ctx?.snapshots),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ACTIVE_KEY });
      queryClient.invalidateQueries({ queryKey: ARCHIVED_KEY });
    },
  });
}

export function useHideConversation() {
  const { session } = useAuth();
  const token = session?.access_token;
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (conversationId) => runly.chat.hideConversation(conversationId, token),
    onMutate: async (conversationId) => {
      await queryClient.cancelQueries({ queryKey: ACTIVE_KEY });
      return { snapshots: patchConversationInCaches(queryClient, conversationId, null) };
    },
    onError: (_e, _v, ctx) => restoreSnapshots(queryClient, ctx?.snapshots),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ACTIVE_KEY }),
  });
}

export function useLeaveConversation() {
  const { session, userProfile } = useAuth();
  const token = session?.access_token;
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (conversationId) => runly.chat.removeMember(conversationId, userProfile?.id, token),
    onMutate: async (conversationId) => {
      await queryClient.cancelQueries({ queryKey: ACTIVE_KEY });
      return { snapshots: patchConversationInCaches(queryClient, conversationId, null) };
    },
    onError: (_e, _v, ctx) => restoreSnapshots(queryClient, ctx?.snapshots),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ACTIVE_KEY });
      queryClient.invalidateQueries({ queryKey: ARCHIVED_KEY });
    },
  });
}

// List-level channel/group delete (conversationId as the mutate arg, unlike
// useDeleteConversation in useCreateConversation.js which is bound to one id).
// Backend enforces channel.manage; direct chats use useHideConversation.
export function useDeleteConversationById() {
  const { session } = useAuth();
  const token = session?.access_token;
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (conversationId) => runly.chat.deleteConversation(conversationId, token),
    onMutate: async (conversationId) => {
      await queryClient.cancelQueries({ queryKey: ACTIVE_KEY });
      return { snapshots: patchConversationInCaches(queryClient, conversationId, null) };
    },
    onError: (_e, _v, ctx) => restoreSnapshots(queryClient, ctx?.snapshots),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ACTIVE_KEY });
      queryClient.invalidateQueries({ queryKey: ARCHIVED_KEY });
    },
  });
}

// List-level mark-read (conversationId as the mutate arg, unlike useMarkRead
// in useChatMessages.js which is bound to one open conversation).
export function useMarkConversationRead() {
  const { session } = useAuth();
  const token = session?.access_token;
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (conversationId) => runly.chat.markRead(conversationId, token),
    onMutate: async (conversationId) => {
      await queryClient.cancelQueries({ queryKey: ACTIVE_KEY });
      return {
        snapshots: patchConversationInCaches(queryClient, conversationId, {
          unread_count: 0,
          unread_mention_count: 0,
        }),
      };
    },
    onError: (_e, _v, ctx) => restoreSnapshots(queryClient, ctx?.snapshots),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ACTIVE_KEY }),
  });
}

// Single dispatcher shared by every conversation-list surface (ChatSidebar,
// FloatingChatHub). Maps a buildConversationActions `action` string to the
// right mutation + toast. `delete` branches on conversation type: direct chats
// hide, channels/groups hard-delete (backend enforces channel.manage).
export function useConversationActionHandler() {
  const { mutate: archiveMutate } = useArchiveConversation();
  const { mutate: unarchiveMutate } = useUnarchiveConversation();
  const { mutate: pinMutate } = usePinConversation();
  const { mutate: muteMutate } = useMuteConversation();
  const { mutate: hideMutate } = useHideConversation();
  const { mutate: leaveMutate } = useLeaveConversation();
  const { mutate: deleteMutate } = useDeleteConversationById();
  const { mutate: markReadMutate } = useMarkConversationRead();

  return useCallback(
    (action, conv) => {
      const id = conv.id;
      const fail = (msg) => () => toast.error(msg);
      switch (action) {
        case "pin":
          pinMutate({ conversationId: id, pinned: true }, { onError: fail("No se pudo fijar la conversacion.") });
          break;
        case "unpin":
          pinMutate({ conversationId: id, pinned: false }, { onError: fail("No se pudo desfijar la conversacion.") });
          break;
        case "mute":
          muteMutate({ conversationId: id, muted: true }, { onError: fail("No se pudo silenciar.") });
          break;
        case "unmute":
          muteMutate({ conversationId: id, muted: false }, { onError: fail("No se pudo reactivar.") });
          break;
        case "read":
          markReadMutate(id);
          break;
        case "archive":
          archiveMutate(id, { onSuccess: () => toast.success("Conversacion archivada."), onError: fail("No se pudo archivar.") });
          break;
        case "unarchive":
          unarchiveMutate(id, { onSuccess: () => toast.success("Conversacion desarchivada."), onError: fail("No se pudo desarchivar.") });
          break;
        case "delete":
          if (conv.type === "direct") {
            hideMutate(id, { onSuccess: () => toast.success("Chat eliminado."), onError: fail("No se pudo eliminar el chat.") });
          } else {
            deleteMutate(id, {
              onSuccess: () => toast.success(conv.type === "channel" ? "Canal eliminado." : "Grupo eliminado."),
              onError: fail("No se pudo eliminar."),
            });
          }
          break;
        case "leave":
          leaveMutate(id, { onSuccess: () => toast.success("Saliste de la conversacion."), onError: fail("No se pudo salir.") });
          break;
        default:
          break;
      }
    },
    [archiveMutate, unarchiveMutate, pinMutate, muteMutate, hideMutate, leaveMutate, deleteMutate, markReadMutate],
  );
}
