import { useRef, useState } from "react";
import { Sparkles, UploadCloud, Loader2 } from "lucide-react";
import { Button } from "./Button.jsx";
import { cn } from "../lib/utils.js";

// A dropzone styled for AI-powered capture flows (photo -> automatic reading),
// visually distinct from the generic FileUploader so the user recognizes an
// "AI step" rather than a plain attachment field. Validation of file size/type
// stays with the caller (e.g. inventory intake already reports its own limits),
// this component only captures files and reflects drag/analyzing state.
export function AIUploadDropzone({
  multiple = false,
  accept = "*/*",
  disabled = false,
  busy = false,
  className,
  title = "Suelta tus fotografías aquí",
  busyLabel = "Analizando con IA…",
  hint,
  actionLabel,
  onFiles,
}) {
  const inputRef = useRef(null);
  const [dragActive, setDragActive] = useState(false);
  const inert = disabled || busy;

  function handleFiles(list) {
    const files = Array.from(list || []).filter(Boolean);
    if (files.length) onFiles?.(files);
  }

  return (
    <div
      onDrop={(event) => {
        event.preventDefault();
        setDragActive(false);
        if (!inert) handleFiles(event.dataTransfer.files);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        if (!inert) setDragActive(true);
      }}
      onDragLeave={() => setDragActive(false)}
      role="button"
      tabIndex={inert ? -1 : 0}
      aria-disabled={inert}
      aria-busy={busy}
      onClick={() => !inert && inputRef.current?.click()}
      onKeyDown={(event) => {
        if (!inert && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          inputRef.current?.click();
        }
      }}
      className={cn(
        "group relative overflow-hidden rounded-2xl border-2 border-dashed p-6 text-center transition-all duration-200",
        dragActive
          ? "scale-[1.01] border-[--color-primary] bg-[--color-primary]/[0.07]"
          : "border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30",
        !inert && "cursor-pointer hover:border-[--color-primary]/60 hover:bg-[--color-primary]/[0.04]",
        inert && "opacity-70",
        className,
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.08] [background:radial-gradient(circle_at_30%_15%,var(--brand-primary),transparent_60%)]"
      />
      <div
        className={cn(
          "relative mx-auto flex h-14 w-14 items-center justify-center rounded-2xl shadow-sm transition-transform",
          busy && "animate-pulse",
        )}
        style={{ background: "var(--brand-primary)", color: "var(--brand-primary-foreground)" }}
      >
        {busy ? <Loader2 className="h-6 w-6 animate-spin" /> : <Sparkles className="h-6 w-6" />}
      </div>
      <p className="relative mt-3 text-sm font-semibold">{busy ? busyLabel : title}</p>
      {hint && <p className="relative mx-auto mt-1 max-w-sm text-xs text-[hsl(var(--muted-foreground))]">{hint}</p>}
      <input
        ref={inputRef}
        type="file"
        multiple={multiple}
        accept={accept}
        disabled={inert}
        className="sr-only"
        onChange={(event) => {
          handleFiles(event.target.files);
          event.target.value = "";
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="relative mt-4"
        disabled={inert}
        onClick={(event) => {
          event.stopPropagation();
          inputRef.current?.click();
        }}
      >
        <UploadCloud className="h-4 w-4" />
        {actionLabel ?? (multiple ? "Seleccionar fotografías" : "Seleccionar fotografía")}
      </Button>
    </div>
  );
}
