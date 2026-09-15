import {
  Badge,
  Button,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  useOfficeActions,
  formatBytes,
  formatDate,
  getKindLabel,
  getFileKind,
} from "@runly/ui";
import { getOfficeFormat } from "@runly/core";
import { ExternalLink, FileSearch } from "lucide-react";
import { resolveFileOrigin } from "../lib/file-origin-resolver";

function Row({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 border-b border-[hsl(var(--border))]/60">
      <span className="text-xs text-[hsl(var(--muted-foreground))]">
        {label}
      </span>
      <span className="text-sm text-right break-all">{value || "—"}</span>
    </div>
  );
}

export function FileDetailPanel({
  open,
  onOpenChange,
  file,
  onGoOrigin,
  onShare,
}) {
  const office = useOfficeActions();
  if (!file) return null;

  const origin = resolveFileOrigin(file);
  const kind = getFileKind(file.mimeType);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <FileSearch className="h-4 w-4" />
            Detalle de archivo
          </SheetTitle>
          <SheetDescription>{file.originalName}</SheetDescription>
        </SheetHeader>
        {office?.enabled && file.enabled !== false && getOfficeFormat(file) && (
          <Button onClick={() => office.open(file.id)}>
            Abrir en Office
          </Button>
        )}
        {onShare && (
          <Button variant="outline" onClick={() => onShare(file)}>
            Compartir y permisos
          </Button>
        )}
        <div className="space-y-2">
          <Row label="Nombre" value={file.originalName} />
          <Row label="Tipo" value={getKindLabel(kind)} />
          <Row label="Tamaño" value={formatBytes(file.sizeBytes)} />
          <Row label="Origen" value={origin.label} />
          <Row
            label="Acceso"
            value={
              file.accessScope === "RESTRICTED"
                ? "Personas seleccionadas"
                : file.visibility === "PUBLIC"
                  ? "Público"
                  : file.entityType === "AtlasFile"
                    ? "Empresa"
                    : "Desde el origen"
            }
          />
          <Row label="Modificado" value={formatDate(file.updatedAt)} />
          <Row label="Subido" value={formatDate(file.createdAt)} />
          <div className="flex items-center justify-between pt-1">
            <span className="text-xs text-[hsl(var(--muted-foreground))]">
              Estado
            </span>
            <Badge variant={file.enabled ? "success" : "secondary"}>
              {file.enabled ? "Activo" : "Deshabilitado"}
            </Badge>
          </div>
        </div>

        <div className="rounded-xl border border-[hsl(var(--border))] p-3 space-y-1.5">
          <p className="text-xs text-[hsl(var(--muted-foreground))]">Origen</p>
          <p className="text-sm font-medium">{origin.label}</p>
          <p className="text-xs text-[hsl(var(--muted-foreground))]">
            {origin.originHint || "Sin informacion adicional"}
          </p>
          {origin.originPath ? (
            <Button
              size="sm"
              className="mt-1"
              onClick={() => onGoOrigin(origin.originPath)}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Ir al origen
            </Button>
          ) : (
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              Origen no navegable.
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
