import {
  useChatMessages,
  useSendMessage,
  useMarkRead,
  useDeleteMessage,
  useDeleteAttachment,
  useToggleReaction,
} from "./useChatMessages";
import { useChatPresence } from "./useChatPresence";
import { mapTypingNames } from "../lib/mirai";
import { useExternalChatData } from "./useExternalChatData";

// Internal (channel/group/direct/mirai) data path. Returns the shape
// ChatWindow consumes; queries are disabled unless this branch is the active one.
function useInternalChatData(conversationId, { enabled }) {
  const gatedId = enabled ? conversationId : null;
  const { data, isLoading, hasMore, isLoadingMore, loadMore } = useChatMessages(gatedId);
  const { mutateAsync: sendMessage } = useSendMessage(conversationId);
  const { mutate: markRead } = useMarkRead(conversationId);
  const { mutate: deleteMessage } = useDeleteMessage(conversationId);
  const {
    mutate: deleteAttachment,
    isPending: isDeletingAttachment,
    variables: deletingAttachmentId,
  } = useDeleteAttachment(conversationId);
  const { mutate: toggleReaction } = useToggleReaction(conversationId);
  const { typingUsersList } = useChatPresence(gatedId);

  return {
    messages: data?.data ?? [],
    isLoading,
    hasMore,
    isLoadingMore,
    loadMore,
    sendMessage,
    markRead,
    deleteMessage,
    deleteAttachment,
    deletingAttachmentId: isDeletingAttachment ? deletingAttachmentId : null,
    toggleReaction: (messageId, emoji, attachmentId) =>
      toggleReaction({ messageId, emoji, attachmentId }),
    typingUsers: mapTypingNames(typingUsersList),
    guestLastReadAt: null,
    sendTyping: undefined,
  };
}

// Selects the data source for ChatWindow. `variant` is stable for a given mount,
// so both sub-hooks are always called (rules of hooks) but only the active one
// runs queries / subscriptions.
export function useChatWindowData(conversationId, variant = "internal", { onStatusChange = null } = {}) {
  const isExternal = variant === "external";
  const internal = useInternalChatData(conversationId, { enabled: !isExternal });
  const external = useExternalChatData(conversationId, { enabled: isExternal, onStatusChange });
  return isExternal ? external : internal;
}
