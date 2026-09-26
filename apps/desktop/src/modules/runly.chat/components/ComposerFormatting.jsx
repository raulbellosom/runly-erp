import { Bold, Italic, Strikethrough, Code } from "lucide-react";
import { renderRichText } from "@runly/ui";

// Extracted from MessageComposer.jsx (pure move, no behavior change) — same
// precedent as AttachmentPreviewCard.jsx/VoiceRecordingControls.jsx, to keep
// that file under the project's 1000-line soft limit (see docs/TASKS.md).

const MARKS = [
  { mark: "*", Icon: Bold, label: "Negrita" },
  { mark: "_", Icon: Italic, label: "Cursiva" },
  { mark: "~", Icon: Strikethrough, label: "Tachado" },
  { mark: "`", Icon: Code, label: "Monoespaciado" },
];

// WhatsApp-style formatting toolbar: appears in-flow (not absolutely
// positioned) the moment there's a real text selection, desktop only — touch
// devices already get the OS's own text-selection menu, same gate as the
// Ctrl/Cmd+B/I keyboard shortcuts these buttons call into (onApplyFormat).
// In-flow rather than floating over the textarea because both this row's and
// the composer's own ancestors set overflow-hidden (rounded-corner clipping)
// — an absolutely-positioned popup here would just be clipped, the same
// problem MentionTextarea's own mention dropdown solves with a body portal,
// which is overkill for four buttons.
export function ComposerFormatToolbar({ onApplyFormat }) {
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
    </div>
  );
}

// Live preview of how the formatting will render once sent — the same
// renderRichText() ChatMessageBubble uses, so this is exactly the eventual
// bubble's output, not an approximation. The caller only renders this once
// real formatting syntax is present, so an unformatted message never gets a
// redundant second copy of itself.
export function ComposerFormatPreview({ body }) {
  return (
    <div className="mx-2 mb-1 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/50 px-2.5 py-1.5">
      <p className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
        Vista previa
      </p>
      <div className="text-sm leading-relaxed">
        {renderRichText(body, { paragraphClassName: "text-left whitespace-pre-wrap wrap-break-word" })}
      </div>
    </div>
  );
}

// Same token shapes chatRichText.jsx actually renders on — a bare stray "*"
// (e.g. "5 * 3") never matches a *pair*, so it correctly does NOT trigger the
// preview above (renderRichText would show it unchanged anyway, but there's
// no point popping a preview that looks identical to the raw text).
export function hasFormattingSyntax(body) {
  return /(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~|`[^`\n]+`|^\s*[-•]\s+|^\s*\d+[.)]\s+)/m.test(body ?? "");
}
