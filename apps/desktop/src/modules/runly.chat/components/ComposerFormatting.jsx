import { Bold, Italic, Strikethrough, Code, List, ListOrdered, Quote } from "lucide-react";

// Extracted from MessageComposer.jsx (pure move, no behavior change) — same
// precedent as AttachmentPreviewCard.jsx/VoiceRecordingControls.jsx, to keep
// that file under the project's 1000-line soft limit (see docs/TASKS.md).

const MARKS = [
  { mark: "*", Icon: Bold, label: "Negrita" },
  { mark: "_", Icon: Italic, label: "Cursiva" },
  { mark: "~", Icon: Strikethrough, label: "Tachado" },
  { mark: "`", Icon: Code, label: "Monoespaciado" },
];

// Line-prefix actions — a different shape from the wrap-around MARKS above:
// each applies a prefix per line (the current line, or every line the
// selection spans) instead of surrounding a single inline span. Handled by
// MentionTextarea's prefixLines, not wrapSelection — see applyLineFormat in
// MessageComposer.jsx.
const LINE_ACTIONS = [
  { kind: "bullet", Icon: List, label: "Lista" },
  { kind: "ordered", Icon: ListOrdered, label: "Lista numerada" },
  { kind: "quote", Icon: Quote, label: "Cita" },
];

// WhatsApp-style formatting toolbar: appears in-flow (not absolutely
// positioned) the moment there's a real text selection, desktop only — touch
// devices already get the OS's own text-selection menu, same gate as the
// Ctrl/Cmd+B/I keyboard shortcuts these buttons call into (onApplyFormat).
// In-flow rather than floating over the textarea because both this row's and
// the composer's own ancestors set overflow-hidden (rounded-corner clipping)
// — an absolutely-positioned popup here would just be clipped, the same
// problem MentionTextarea's own mention dropdown solves with a body portal,
// which is overkill for a handful of buttons.
export function ComposerFormatToolbar({ onApplyFormat, onApplyLineFormat }) {
  return (
    <div className="flex items-center gap-0.5 border-b border-[hsl(var(--border))] px-1.5 py-1">
      {MARKS.map(({ mark, Icon, label }) => (
        <button
          key={mark}
          type="button"
          // A click would blur the textarea before onClick fires, collapsing
          // the selection this button is meant to wrap — preventDefault on
          // mousedown keeps focus (and the selection) in the textarea
          // straight through the click.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onApplyFormat(mark)}
          className="flex h-6 w-6 items-center justify-center rounded text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] transition-colors"
          title={label}
          aria-label={label}
        >
          <Icon className="h-3.5 w-3.5" />
        </button>
      ))}
      <div className="mx-0.5 h-4 w-px shrink-0 bg-[hsl(var(--border))]" />
      {LINE_ACTIONS.map(({ kind, Icon, label }) => (
        <button
          key={kind}
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onApplyLineFormat(kind)}
          className="flex h-6 w-6 items-center justify-center rounded text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] transition-colors"
          title={label}
          aria-label={label}
        >
          <Icon className="h-3.5 w-3.5" />
        </button>
      ))}
    </div>
  );
}
