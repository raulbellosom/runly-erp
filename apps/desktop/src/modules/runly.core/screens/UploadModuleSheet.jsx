import { useState, useRef } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Button,
  Input,
  Label,
} from "@runly/ui";
import { Upload, FileArchive, X } from "lucide-react";
import { toast } from "sonner";
import { runly } from "../../../lib/runly";
import { useAuth } from "../../../auth/AuthProvider";

function guessKeyFromFilename(filename) {
  const base = filename.replace(/\.zip$/i, "");
  const match = base.match(/^([a-z][a-z0-9]*\.[a-z][a-z0-9._-]*)/);
  return match ? match[1] : base;
}

function DropZone({ file, onFile, onClear, disabled }) {
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

export function UploadModuleSheet({ open, onOpenChange, onSuccess }) {
  const { session } = useAuth();
  const token = session?.access_token;
  const moduleKeyInputRef = useRef(null);

  const [file, setFile] = useState(null);
  const [moduleKey, setModuleKey] = useState("");
  const [isUploading, setIsUploading] = useState(false);

  function handleFile(selected) {
    setFile(selected);
    setModuleKey(guessKeyFromFilename(selected.name));
  }

  function handleClear() {
    setFile(null);
    setModuleKey("");
  }

  function handleClose(open) {
    if (!open) {
      setFile(null);
      setModuleKey("");
    }
    onOpenChange(open);
  }

  async function handleUpload() {
    if (!file || !moduleKey.trim() || !token) return;

    const key = moduleKey.trim();
    const formData = new FormData();
    formData.append("file", file);

    setIsUploading(true);
    const toastId = toast.loading(`Subiendo ${key}...`);

    try {
      const result = await runly.modules.uploadModuleZip(key, formData, token);
      if (result?.error) {
        toast.error(result.error, {
          id: toastId,
          description: result.details ? JSON.stringify(result.details) : undefined,
        });
        return;
      }
      toast.success(`Módulo ${key} subido correctamente`, {
        id: toastId,
        description: `${result?.data?.fileCount ?? "?"} archivos extraídos. Sincronizando catálogo...`,
      });
      if (result?.data?.builderDetached) {
        toast.info("Este módulo pasó a modo avanzado", {
          description: "Venía del Constructor de módulos y el ZIP trae cambios de código: el Constructor ya no lo editará ni publicará, para no sobrescribirlos.",
        });
      }
      handleClose(false);
      onSuccess?.();
    } catch (err) {
      toast.error("Error al subir el módulo", {
        id: toastId,
        description: err?.message ?? "Error desconocido",
      });
    } finally {
      setIsUploading(false);
    }
  }

  const canSubmit = Boolean(file && moduleKey.trim() && token && !isUploading);

  return (
    <Sheet open={open} onOpenChange={handleClose}>
      <SheetContent
        className="w-full sm:max-w-md overflow-y-auto"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          moduleKeyInputRef.current?.focus();
        }}
      >
        <SheetHeader>
          <SheetTitle>Subir módulo</SheetTitle>
        </SheetHeader>

        <div className="mt-6 space-y-5">
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            Sube un archivo ZIP con el código de tu módulo custom. El módulo se
            extraerá al servidor y quedará disponible para instalar desde el
            catálogo.
          </p>

          <div className="space-y-2">
            <Label>Archivo ZIP</Label>
            <DropZone
              file={file}
              onFile={handleFile}
              onClear={handleClear}
              disabled={isUploading}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="module-key">Clave del módulo</Label>
            <Input
              ref={moduleKeyInputRef}
              id="module-key"
              value={moduleKey}
              onChange={(e) => setModuleKey(e.target.value)}
              placeholder="custom.mi-modulo"
              disabled={isUploading}
            />
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              Debe coincidir con el campo <code>key</code> en{" "}
              <code>module.manifest.js</code>.
            </p>
          </div>

          <Button
            className="w-full bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-400"
            disabled={!canSubmit}
            onClick={handleUpload}
          >
            <Upload className="h-4 w-4" />
            {isUploading ? "Subiendo..." : "Subir módulo"}
          </Button>

          <p className="text-xs text-[hsl(var(--muted-foreground))] border border-[hsl(var(--border))] rounded-lg px-3 py-2">
            El ZIP se extrae directamente en el servidor. Solo sube módulos de
            fuentes de confianza.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
