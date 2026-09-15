import { useEffect, useRef } from "react";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  Input,
  FileVisual,
  formatBytes,
  formatDate,
  getFileKind,
  getKindLabel,
} from "@runly/ui";
import { Pencil } from "lucide-react";

function MetaRow({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 border-b border-[hsl(var(--border))]/50 last:border-0">
      <span className="text-xs text-[hsl(var(--muted-foreground))] shrink-0">
        {label}
      </span>
      <span className="text-xs text-right break-all text-[hsl(var(--foreground))]">
        {value || "—"}
      </span>
    </div>
  );
}

export function FileRenameModal({
  open,
  onOpenChange,
  file,
  previewUrl,
  value,
  onChange,
  onSave,
  isPending,
}) {
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      // Focus input after dialog animation settles
      const t = setTimeout(() => inputRef.current?.select(), 80);
      return () => clearTimeout(t);
    }
  }, [open]);

  if (!file) return null;

  const kind = getFileKind(file.mimeType);
  const isImage = kind === "image" && Boolean(previewUrl);
  const canSave = Boolean(value?.trim()) && !isPending;

  function handleKeyDown(e) {
    if (e.key === "Enter" && canSave) onSave();
    if (e.key === "Escape") onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl p-0 overflow-hidden gap-0">
        <div className="flex min-h-0">
          {/* Left: preview */}
          <div className="w-56 shrink-0 flex flex-col items-center justify-center bg-[hsl(var(--muted))]/40 border-r border-[hsl(var(--border))] p-6 gap-4">
            {isImage ? (
              <div className="w-full rounded-xl overflow-hidden border border-[hsl(var(--border))] shadow-sm">
                <img
                  src={previewUrl}
                  alt={file.originalName}
                  className="w-full h-auto object-cover max-h-48"
                />
              </div>
            ) : (
              <div className="flex h-28 w-28 items-center justify-center rounded-2xl bg-[hsl(var(--card))] border border-[hsl(var(--border))] shadow-sm">
                <FileVisual
                  file={file}
                  previewUrl={null}
                  className="h-12 w-12 rounded bg-transparent"
                />
              </div>
            )}
            <div className="w-full text-center space-y-1">
              <p className="text-xs font-semibold text-[hsl(var(--foreground))] truncate w-full px-1 text-center">
                {getKindLabel(kind)}
              </p>
              <p className="text-[11px] text-[hsl(var(--muted-foreground))] truncate w-full px-1 text-center">
                {file.mimeType}
              </p>
            </div>
          </div>

          {/* Right: details + rename input */}
          <div className="flex-1 flex flex-col min-w-0">
            {/* Header */}
            <div className="flex items-center gap-2 px-5 pt-5 pb-3 border-b border-[hsl(var(--border))]">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[hsl(var(--primary))]/10">
                <Pencil className="h-3.5 w-3.5 text-[hsl(var(--primary))]" />
              </div>
              <div>
                <DialogTitle className="text-sm font-semibold text-[hsl(var(--foreground))] leading-none">
                  Renombrar archivo
                </DialogTitle>
                <p className="text-[11px] text-[hsl(var(--muted-foreground))] mt-0.5">
                  El nombre es solo visual, no afecta el objeto en
                  almacenamiento.
                </p>
              </div>
            </div>

            {/* Details */}
            <div className="px-5 py-3 border-b border-[hsl(var(--border))]">
              <MetaRow label="Nombre actual" value={file.originalName} />
              <MetaRow label="Tamano" value={formatBytes(file.sizeBytes)} />
              <MetaRow label="Subido" value={formatDate(file.createdAt)} />
              <MetaRow label="Modulo" value={file.moduleKey} />
              <MetaRow
                label="Entidad"
                value={
                  file.entityType
                    ? `${file.entityType}${file.entityId ? ` · ${file.entityId.slice(0, 8)}…` : ""}`
                    : null
                }
              />
              <div className="flex items-center justify-between py-1.5">
                <span className="text-xs text-[hsl(var(--muted-foreground))]">
                  Estado
                </span>
                <Badge variant={file.enabled ? "success" : "secondary"}>
                  {file.enabled ? "Activo" : "Deshabilitado"}
                </Badge>
              </div>
            </div>

            {/* Rename input */}
            <div className="px-5 py-4 space-y-2">
              <label
                htmlFor="rename-input"
                className="block text-xs font-medium text-[hsl(var(--foreground))]"
              >
                Nuevo nombre
              </label>
              <Input
                id="rename-input"
                ref={inputRef}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={file.originalName}
                disabled={isPending}
                autoComplete="off"
                spellCheck={false}
              />
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 px-5 pb-5 pt-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onOpenChange(false)}
                disabled={isPending}
              >
                Cancelar
              </Button>
              <Button size="sm" onClick={onSave} disabled={!canSave}>
                {isPending ? "Guardando..." : "Guardar nombre"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
