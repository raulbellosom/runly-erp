import { X, Send, Mic } from "lucide-react";

// Extracted from MessageComposer.jsx (pure move, no behavior change) — same
// precedent as AttachmentPreviewCard.jsx: recording state, refs, and handlers
// (startRecording/stopRecording/finalizeRecording) stay owned by
// MessageComposer; only the presentational blocks moved here.

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

// Toolbar trigger button — shown only when there's nothing else ready to send.
export function VoiceMicButton({ btnSize, iconSize, disabled, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        "shrink-0 flex items-center justify-center rounded-full text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--border))] transition-colors touch-manipulation",
        btnSize,
      ].join(" ")}
      title="Nota de voz"
    >
      <Mic className={iconSize} />
    </button>
  );
}

// Full-width bar shown instead of the textarea+toolbar while recording.
export function VoiceRecordingBar({ seconds, onCancel, onSend }) {
  return (
    <div className="chat-glass flex items-center gap-2 rounded-2xl px-3 py-2">
      {/* Cancel */}
      <button
        type="button"
        onClick={onCancel}
        className="shrink-0 flex items-center justify-center rounded-full border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:text-red-500 hover:border-red-400 transition-colors touch-manipulation h-8 w-8"
        title="Cancelar nota de voz"
      >
        <X className="h-4 w-4" />
      </button>

      {/* Red pulse dot + timer */}
      <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse shrink-0" />
      <span className="text-sm font-mono tabular-nums flex-1 text-center">
        {formatDuration(seconds)}
      </span>

      {/* Send */}
      <button
        type="button"
        onClick={onSend}
        className="shrink-0 flex items-center justify-center rounded-full bg-(--brand-primary) text-(--brand-primary-foreground) hover:opacity-90 active:scale-95 transition-[opacity,transform] touch-manipulation h-8 w-8"
        title="Enviar nota de voz"
      >
        <Send className="h-4 w-4" />
      </button>
    </div>
  );
}
