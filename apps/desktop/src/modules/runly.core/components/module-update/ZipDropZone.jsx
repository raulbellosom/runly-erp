// Drag-and-drop / click picker for a module ZIP (Módulos > Subir módulo and
// the Builder's "Subir actualización").
import { useRef, useState } from "react";
import { FileArchive, Upload, X } from "lucide-react";
import { toast } from "sonner";

export function ZipDropZone({ file, onFile, onClear, disabled }) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    if (disabled) return;
    const dropped = e.dataTransfer.files[0];
    if (dropped?.name.toLowerCase().endsWith(".zip")) {
      onFile(dropped);
    } else {
      toast.error("Solo se aceptan archivos ZIP");
    }
  }

  function handleDragOver(e) {
    e.preventDefault();
    if (!disabled) setDragOver(true);
  }

  function handleClick() {
    if (!disabled) inputRef.current?.click();
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleClick();
    }
  }

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label="Seleccionar archivo ZIP"
      aria-disabled={disabled}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={() => setDragOver(false)}
      onDragEnd={() => setDragOver(false)}
      className={[
        "relative border-2 border-dashed rounded-xl px-4 py-8 flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]",
        dragOver
          ? "border-blue-500 bg-blue-500/10 text-blue-400"
          : file
          ? "border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30"
          : "border-[hsl(var(--border))] hover:border-[hsl(var(--muted-foreground))]/50 hover:bg-[hsl(var(--muted))]/20",
        disabled && "opacity-50 cursor-not-allowed pointer-events-none",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {file ? (
        <>
          <FileArchive className="h-8 w-8 text-blue-400" />
          <p className="text-sm font-medium text-[hsl(var(--foreground))] text-center break-all px-2">
            {file.name}
          </p>
          <p className="text-xs text-[hsl(var(--muted-foreground))]">
            {(file.size / 1024 / 1024).toFixed(2)} MB
          </p>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClear();
            }}
            className="absolute top-2 right-2 rounded-md p-1 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors"
            aria-label="Quitar archivo"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </>
      ) : (
        <>
          <Upload className="h-8 w-8 text-[hsl(var(--muted-foreground))]" />
          <p className="text-sm text-[hsl(var(--muted-foreground))] text-center">
            {dragOver ? "Suelta el archivo aqui" : "Arrastra un ZIP aqui"}
          </p>
          <p className="text-xs text-[hsl(var(--muted-foreground))]">
            o haz clic para seleccionar
          </p>
        </>
      )}
      <input
        ref={inputRef}
        type="file"
        accept=".zip"
        tabIndex={-1}
        className="sr-only"
        disabled={disabled}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}
