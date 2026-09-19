// apps/desktop/src/modules/runly.chat/hooks/useMirAIPanel.js
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { runly } from "../../../lib/runly";
import { useAuth } from "../../../auth/AuthProvider";

// The private per-conversation MirAI panel thread (Spec 2).
export function useMiraiPanelThread(conversationId, { enabled = true } = {}) {
  const { session } = useAuth();
  const token = session?.access_token;
  return useQuery({
    queryKey: ["chat-mirai-panel", conversationId],
    enabled: enabled && Boolean(token && conversationId),
    staleTime: 0,
    queryFn: async () => {
      const res = await runly.chat.mirai.panel(conversationId, token);
      return res?.data ?? { threadId: null, messages: [] };
    },
  });
}

export function useSendMiraiPanel(conversationId) {
  const { session } = useAuth();
  const token = session?.access_token;
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ content, focusMessageId }) =>
      runly.chat.mirai.panelSend(
        conversationId,
        { content, focusMessageId: focusMessageId ?? undefined },
        token,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["chat-mirai-panel", conversationId] }),
  });
}

export function useClearMiraiPanel(conversationId) {
  const { session } = useAuth();
  const token = session?.access_token;
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => runly.chat.mirai.panelClear(conversationId, token),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["chat-mirai-panel", conversationId] }),
  });
}
