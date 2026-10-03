import { Button } from "./Button.jsx";
import { cn } from "../lib/utils.js";

// Universal save/cancel bar for forms (RunlyForm uses it; custom forms can
// too). Must render inside the <form> so the primary button submits it.
//
// - floating=false (inside a Dialog/Sheet): plain buttons, always visible.
// - floating=true (full page): a sticky glass bar on phones/tablets; on large
//   screens a pill floating at the bottom right that slides in only while
//   `dirty` (or `submitting`, or `forceVisible`, e.g. to show an error).
export function FormSaveBar({
  floating = true,
  dirty = false,
  submitting = false,
  forceVisible = false,
  submitLabel = "Guardar",
  cancelLabel = "Cancelar",
  onCancel,
  className,
}) {
  const buttons = (
    <div className="flex items-center gap-2">
      <Button type="button" variant="outline" onClick={() => onCancel?.()} disabled={submitting}>
        {cancelLabel}
      </Button>
      <Button type="submit" loading={submitting} disabled={submitting}>
        {submitting ? "Guardando..." : submitLabel}
      </Button>
    </div>
  );

  if (!floating) {
    return (
      <div className={cn("sticky bottom-0 z-10 flex items-center justify-between gap-2 pt-3", className)}>
        <p className="text-xs text-[hsl(var(--muted-foreground))]">{submitting ? "Guardando..." : ""}</p>
        {buttons}
      </div>
    );
  }

  const shown = dirty || submitting || forceVisible;
  return (
    <div
      className={cn(
        "glass-strong sticky bottom-0 z-10 flex items-center justify-between gap-2 rounded-xl px-4 py-3",
        "lg:fixed lg:bottom-16 lg:right-8 lg:z-40 lg:justify-end lg:gap-3 lg:rounded-2xl lg:border lg:border-[hsl(var(--border))] lg:py-2.5 lg:pl-5 lg:pr-2.5 lg:shadow-2xl lg:transition-all lg:duration-300 lg:ease-out",
        shown
          ? "lg:visible lg:translate-y-0 lg:scale-100 lg:opacity-100"
          : "lg:invisible lg:pointer-events-none lg:translate-y-6 lg:scale-95 lg:opacity-0",
        className,
      )}
      aria-live="polite"
    >
      <p className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]">
        {submitting ? (
          "Guardando..."
        ) : dirty ? (
          <>
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-(--brand-primary) opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-(--brand-primary)" />
            </span>
            <span className="font-medium text-[hsl(var(--foreground))]">Cambios sin guardar</span>
          </>
        ) : null}
      </p>
      {buttons}
    </div>
  );
}

export default FormSaveBar;
