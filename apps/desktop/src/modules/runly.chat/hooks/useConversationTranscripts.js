import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../../auth/AuthProvider";
import { runly } from "../../../lib/runly";

function unwrap(r) { return r?.data ?? r; }

// Same shape as useConversationRecordings.js: independent history query,
// polls while any transcript is still in flight (PENDING/PROCESSING) so a
// transcript that finishes while the view is open flips to READY without
// the user needing to re-open the panel.
export function useConversationTranscripts(conversationId, enabled = true) {
  const { session } = useAuth();
  return useQuery({
    queryKey: ["chat-transcripts", conversationId],
    enabled: Boolean(enabled && conversationId && session?.access_token),
    staleTime: 15_000,
    refetchInterval: (query) => {
      const rows = unwrap(query.state.data) ?? [];
      return rows.some((r) => ["PENDING", "PROCESSING"].includes(r.status)) ? 8000 : false;
    },
    queryFn: () => runly.calls.listTranscripts(conversationId, session.access_token),
  });
}

export function useTranscript(transcriptId, enabled = true) {
  const { session } = useAuth();
  return useQuery({
    queryKey: ["chat-transcript", transcriptId],
    enabled: Boolean(enabled && transcriptId && session?.access_token),
    staleTime: 15_000,
    refetchInterval: (query) => {
      const row = unwrap(query.state.data);
      return row && ["PENDING", "PROCESSING"].includes(row.status) ? 5000 : false;
    },
    queryFn: () => runly.calls.getTranscript(transcriptId, session.access_token),
  });
}

export function useRequestTranscript(conversationId) {
  const { session } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (callId) => runly.calls.requestTranscript(callId, session.access_token),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["chat-transcripts", conversationId] }),
  });
}

export function useRetryTranscript(conversationId) {
  const { session } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (transcriptId) => runly.calls.retryTranscript(transcriptId, session.access_token),
    onSuccess: (_data, transcriptId) => {
      qc.invalidateQueries({ queryKey: ["chat-transcripts", conversationId] });
      // Without this, an open TranscriptViewerDialog keeps showing the old
      // FAILED status until its own 15s staleTime lapses — its
      // refetchInterval only re-polls once the cached row already reads
      // PENDING/PROCESSING, so the transition itself needs an explicit nudge.
      qc.invalidateQueries({ queryKey: ["chat-transcript", transcriptId] });
    },
  });
}

export function useRegenerateTranscript(conversationId) {
  const { session } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (transcriptId) => runly.calls.regenerateTranscript(transcriptId, session.access_token),
    onSuccess: (_data, transcriptId) => {
      qc.invalidateQueries({ queryKey: ["chat-transcripts", conversationId] });
      qc.invalidateQueries({ queryKey: ["chat-transcript", transcriptId] });
    },
  });
}

export function useDeleteTranscript(conversationId) {
  const { session } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (transcriptId) => runly.calls.deleteTranscript(transcriptId, session.access_token),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["chat-transcripts", conversationId] }),
  });
}

export function useAnalyzeTranscript(conversationId) {
  const { session } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (transcriptId) => runly.calls.analyzeTranscript(transcriptId, session.access_token),
    onSuccess: (_data, transcriptId) => {
      qc.invalidateQueries({ queryKey: ["chat-transcript-analysis", transcriptId] });
    },
  });
}

export function useCommitTranscriptProposals(conversationId) {
  const { session } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ transcriptId, ...body }) => runly.calls.commitTranscriptProposals(transcriptId, body, session.access_token),
    onSuccess: (_data, { transcriptId }) => {
      qc.invalidateQueries({ queryKey: ["chat-transcript-analysis", transcriptId] });
    },
  });
}
