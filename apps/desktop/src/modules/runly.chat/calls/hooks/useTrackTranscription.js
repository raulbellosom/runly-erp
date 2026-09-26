import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "../../../../auth/AuthProvider";
import { runly } from "../../../../lib/runly";

function unwrap(r) { return r?.data ?? r; }

// Mirrors useCallRecording.js: polls the conversation's transcripts every 5s
// while the call is open and exposes start/stop for the V2 "transcripción
// con hablantes" capture (docs/TRANSCRIPTION_SPEC.md §2.2) — a live per-track
// LiveKit Egress capture, distinct from the V1 "Analizar" flow that runs
// after the call ends against an existing recording.
export function useTrackTranscription({ callId, conversationId }) {
  const { session } = useAuth();
  const token = session?.access_token;
  const [activeTranscript, setActiveTranscript] = useState(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef(null);

  const refresh = useCallback(async () => {
    if (!conversationId || !token) return;
    try {
      const res = unwrap(await runly.calls.listTranscripts(conversationId, token));
      setActiveTranscript((res ?? []).find((t) => t.callId === callId && t.status === "CAPTURING") ?? null);
    } catch { /* transient — next poll retries */ }
  }, [callId, conversationId, token]);

  useEffect(() => {
    if (!conversationId || !token) return undefined;
    refresh();
    timer.current = setInterval(refresh, 5000);
    return () => clearInterval(timer.current);
  }, [conversationId, token, refresh]);

  const start = useCallback(async () => {
    setBusy(true);
    try {
      await runly.calls.startTrackTranscription(callId, token);
      await refresh();
    } catch (e) {
      toast.error(e?.message || "No se pudo iniciar la transcripción con hablantes.");
    } finally {
      setBusy(false);
    }
  }, [callId, token, refresh]);

  const stop = useCallback(async () => {
    setBusy(true);
    try {
      await runly.calls.stopTrackTranscription(callId, token);
      await refresh();
    } catch (e) {
      toast.error(e?.message || "No se pudo detener la transcripción con hablantes.");
    } finally {
      setBusy(false);
    }
  }, [callId, token, refresh]);

  return { active: Boolean(activeTranscript), busy, start, stop };
}
