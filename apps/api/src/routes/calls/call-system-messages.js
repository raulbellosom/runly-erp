// Pure helpers for the system messages runly.calls posts into the bound
// chat_conversation. No DB, no side effects — see call-service.postCallSystemMessage
// for the insert/broadcast.

export function formatCallDuration(totalSeconds) {
  const s = Number.isFinite(totalSeconds) && totalSeconds > 0 ? Math.floor(totalSeconds) : 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

// spec:
//   event:     "started" | "ended"
//   kind:      "AUDIO" | "VIDEO"
//   endReason: "ended" | "missed" | "rejected" | null   (ignored for "started")
//   startedAt: Date | string | null
//   endedAt:   Date | string | null   (defaults to "now" when omitted)
export function buildCallSystemMessage({ event, kind, endReason = null, startedAt = null, endedAt = null }) {
  const callKind = kind === "VIDEO" ? "VIDEO" : "AUDIO";

  if (event === "started") {
    return {
      body: callKind === "VIDEO" ? "Videollamada iniciada" : "Llamada de voz iniciada",
      metadata: { call: { kind: callKind, event: "started", endReason: null, durationSec: null } },
    };
  }

  if (endReason === "rejected") {
    return {
      body: "Llamada rechazada",
      metadata: { call: { kind: callKind, event: "ended", endReason: "rejected", durationSec: null } },
    };
  }

  if (endReason === "missed" || !startedAt) {
    return {
      body: "Llamada perdida",
      metadata: { call: { kind: callKind, event: "ended", endReason: "missed", durationSec: null } },
    };
  }

  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  const durationSec = Math.max(0, Math.round((end - start) / 1000));
  return {
    body: `Llamada finalizada · ${formatCallDuration(durationSec)}`,
    metadata: { call: { kind: callKind, event: "ended", endReason: "ended", durationSec } },
  };
}

// spec: { recordingId: string, durationMs: number|null }
export function buildRecordingReadyMessage({ recordingId, durationMs }) {
  const totalSeconds = Number.isFinite(durationMs) && durationMs > 0 ? Math.round(durationMs / 1000) : 0;
  return {
    body: `Grabación lista · ${formatCallDuration(totalSeconds)}`,
    metadata: { recording: { recordingId, durationMs: durationMs ?? null } },
  };
}

// spec: { transcriptId: string, durationMs: number|null }
export function buildTranscriptReadyMessage({ transcriptId, durationMs }) {
  const totalSeconds = Number.isFinite(durationMs) && durationMs > 0 ? Math.round(durationMs / 1000) : 0;
  return {
    body: `Transcripción lista · ${formatCallDuration(totalSeconds)}`,
    metadata: { transcript: { transcriptId, durationMs: durationMs ?? null } },
  };
}
