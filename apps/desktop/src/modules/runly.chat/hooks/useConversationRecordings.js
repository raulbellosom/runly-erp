import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../../auth/AuthProvider";
import { runly } from "../../../lib/runly";

function unwrap(r) { return r?.data ?? r; }

// Independent history query, mirroring useConversationFiles.js: opening the
// "Grabaciones" view must not change chat scroll or realtime subscriptions.
// Polls while any recording is still in flight (STARTING/ACTIVE/PROCESSING)
// so a recording that finishes processing while the view is open flips to
// READY without the user needing to re-open the panel.
export function useConversationRecordings(conversationId, enabled = true) {
  const { session } = useAuth();
  return useQuery({
    queryKey: ["chat-recordings", conversationId],
    enabled: Boolean(enabled && conversationId && session?.access_token),
    staleTime: 15_000,
    refetchInterval: (query) => {
      const rows = unwrap(query.state.data) ?? [];
      return rows.some((r) => ["STARTING", "ACTIVE", "PROCESSING"].includes(r.status)) ? 8000 : false;
    },
    queryFn: () => runly.calls.listRecordings(conversationId, session.access_token),
  });
}

export function useDeleteRecording(conversationId) {
  const { session } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (recordingId) => runly.calls.deleteRecording(recordingId, session.access_token),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["chat-recordings", conversationId] }),
  });
}

export function useRenameRecording(conversationId) {
  const { session } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ recordingId, title }) => runly.calls.renameRecording(recordingId, title, session.access_token),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["chat-recordings", conversationId] }),
  });
}
