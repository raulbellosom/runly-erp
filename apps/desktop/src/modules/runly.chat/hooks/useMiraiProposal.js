// apps/desktop/src/modules/runly.chat/hooks/useMiraiProposal.js
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { runly } from "../../../lib/runly";
import { useAuth } from "../../../auth/AuthProvider";

// One MirAI action proposal (spec 2026-09-30-mirai-actions). 404 for anyone
// but its author — the card then renders nothing.
export function useMiraiProposal(proposalId) {
  const { session } = useAuth();
  const token = session?.access_token;
  return useQuery({
    queryKey: ["chat-mirai-proposal", proposalId],
    enabled: Boolean(token && proposalId),
    retry: false,
    queryFn: async () => (await runly.chat.mirai.proposal(proposalId, token))?.data ?? null,
  });
}

export function useDecideMiraiProposal(proposalId, { conversationId } = {}) {
  const { session } = useAuth();
  const token = session?.access_token;
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (decision) => (decision === "confirm"
      ? runly.chat.mirai.confirmProposal(proposalId, token)
      : runly.chat.mirai.cancelProposal(proposalId, token)),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["chat-mirai-proposal", proposalId] });
      if (conversationId) qc.invalidateQueries({ queryKey: ["chat-mirai-panel", conversationId] });
    },
  });
}
