import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "../lib/utils.js";

// Read-only label/value pair with a copy button revealed on hover/focus.
// Renders `emptyText` (and no button) when the value is empty. Pass
// copyable={false} for descriptive values nobody pastes elsewhere (type, category).
export function CopyableValue({ label, value, display, emptyText = "Sin capturar", mono = false, copyable = true, className }) {
  const [copied, setCopied] = useState(false);
  const hasValue = value !== null && value !== undefined && String(value).trim() !== "";

  async function copy() {
    try {
      await navigator.clipboard.writeText(String(value));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable (insecure context); nothing else to do.
    }
  }

  return (
    <div className={cn("group min-w-0", className)}>
      {label && (
        <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[hsl(var(--muted-foreground))]">
          {label}
        </dt>
      )}
      <dd className="mt-1 flex min-w-0 items-center gap-2">
        <span
          className={cn(
            "min-w-0 break-words text-sm",
            hasValue ? "text-[hsl(var(--foreground))]" : "text-[hsl(var(--muted-foreground))]",
            mono && hasValue && "font-mono tracking-wide tabular-nums",
          )}
        >
          {hasValue ? display ?? value : emptyText}
        </span>
        {hasValue && copyable && (
          <button
            type="button"
            onClick={copy}
            aria-label={`Copiar ${label ?? "valor"}`}
            className="shrink-0 rounded-md p-1 text-[hsl(var(--muted-foreground))] opacity-0 transition-opacity hover:text-[hsl(var(--foreground))] focus-visible:opacity-100 group-hover:opacity-100"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        )}
      </dd>
    </div>
  );
}
