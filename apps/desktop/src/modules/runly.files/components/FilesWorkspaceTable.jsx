import { useMemo } from "react";
import {
  DataTable,
  Checkbox,
  Button,
  ActionMenu,
  Badge,
  TypeBadge,
  FileVisual,
  formatBytes,
  formatDate,
  getFileKind,
  getKindLabel,
  getKindAccent,
} from "@runly/ui";
import {
  Download,
  Link2,
  Info,
  Pencil,
  Trash2,
  Users,
  LockKeyhole,
  Building2,
  Power,
} from "lucide-react";

export function FilesWorkspaceTable({
  files,
  selectedSet,
  onToggleSelect,
  onSelectVisible,
  onClearSelection,
  onPreview,
  onDownload,
  onCopyLink,
  onDetail,
  onShare,
  onRename,
  onDelete,
  onToggleEnabled,
  canUpdate,
  canDelete,
  profileId,
  isCompanyAdmin,
  previewMap,
}) {
  const columns = useMemo(
    () =>
      [
        {
          id: "select",
          header: () => (
            <Checkbox
              aria-label="Seleccionar esta página"
              checked={
                files.length > 0 && files.every((f) => selectedSet.has(f.id))
              }
              onCheckedChange={(checked) =>
                checked ? onSelectVisible() : onClearSelection()
              }
            />
          ),
          cell: ({ row }) => (
            <Checkbox
              aria-label={`Seleccionar ${row.original.originalName}`}
              checked={selectedSet.has(row.original.id)}
              onCheckedChange={() => onToggleSelect(row.original.id)}
            />
          ),
        },
        {
          accessorKey: "originalName",
          header: "Nombre",
          cell: ({ row }) => {
            const f = row.original;
            return (
              <div className="files-name-cell flex items-center gap-3 min-w-[180px] max-w-sm">
                <FileVisual
                  file={f}
                  previewUrl={previewMap.get(f.id)}
                  className="h-10 w-10 shrink-0 rounded-lg object-cover bg-[hsl(var(--muted))]"
                />
                <div className="min-w-0">
                  <Button
                    variant="link"
                    className="block max-w-full truncate text-left text-[hsl(var(--foreground))] font-medium"
                    onClick={() => onPreview(f)}
                    title={f.originalName}
                  >
                    {f.originalName}
                  </Button>
                  <p className="text-xs text-[hsl(var(--muted-foreground))]">
                    {formatBytes(f.sizeBytes)}
                  </p>
                </div>
              </div>
            );
          },
        },
        {
          id: "kind",
          header: "Tipo",
          cell: ({ row }) => {
            const kind = getFileKind(row.original);
            return (
              <TypeBadge accent={getKindAccent(kind)}>
                {getKindLabel(kind)}
              </TypeBadge>
            );
          },
        },
        {
          id: "access",
          header: "Acceso",
          cell: ({ row }) => (
            <span className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap text-[hsl(var(--muted-foreground))]">
              {row.original.accessScope === "RESTRICTED" ? (
                <>
                  <LockKeyhole className="h-3.5 w-3.5" />
                  Restringido
                </>
              ) : (
                <>
                  <Building2 className="h-3.5 w-3.5" />
                  {row.original.visibility === "PUBLIC"
                    ? "Público"
                    : row.original.entityType === "AtlasFile"
                      ? "Empresa"
                      : "Desde el origen"}
                </>
              )}
            </span>
          ),
        },
        {
          id: "origin",
          header: "Origen",
          cell: ({ row }) => (
            <span className="text-xs whitespace-nowrap">
              {row.original.moduleKey === "runly.files"
                ? "Archivos"
                : (row.original.moduleKey ?? "Adjunto").replace(/^atlas\./, "")}
            </span>
          ),
        },
        {
          accessorKey: "updatedAt",
          header: "Modificado",
          cell: ({ row }) => (
            <span className="text-xs text-[hsl(var(--muted-foreground))] whitespace-nowrap">
              {formatDate(row.original.updatedAt ?? row.original.createdAt)}
            </span>
          ),
        },
        {
          id: "actions",
          header: "",
          cell: ({ row }) => {
            const f = row.original;
            const manageable =
              f.accessScope !== "RESTRICTED" ||
              isCompanyAdmin ||
              f.uploadedById === profileId;
            return (
              <div className="flex items-center justify-end gap-1">
                {!f.enabled && <Badge variant="secondary">Deshabilitado</Badge>}
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Compartir ${f.originalName}`}
                  title="Compartir y permisos"
                  onClick={() => onShare(f)}
                >
                  <Users className="h-4 w-4" />
                </Button>
                <ActionMenu
                  items={[
                    {
                      label: "Detalles",
                      icon: Info,
                      onClick: () => onDetail(f),
                    },
                    {
                      label: "Copiar enlace",
                      icon: Link2,
                      onClick: () => onCopyLink(f),
                    },
                    {
                      label: "Descargar",
                      icon: Download,
                      onClick: () => onDownload(f),
                    },
                    ...(canUpdate && manageable
                      ? [
                          {
                            label: "Renombrar",
                            icon: Pencil,
                            onClick: () => onRename(f),
                          },
                          {
                            label: f.enabled ? "Deshabilitar" : "Habilitar",
                            icon: Power,
                            onClick: () => onToggleEnabled(f),
                          },
                        ]
                      : []),
                    ...(canDelete && manageable
                      ? [
                          {
                            label: "Eliminar",
                            icon: Trash2,
                            variant: "destructive",
                            onClick: () => onDelete(f),
                          },
                        ]
                      : []),
                  ]}
                />
              </div>
            );
          },
        },
      ].map((c) => ({ ...c, enableSorting: false })),
    [
      files,
      selectedSet,
      onToggleSelect,
      onSelectVisible,
      onClearSelection,
      onPreview,
      onDownload,
      onCopyLink,
      onDetail,
      onShare,
      onRename,
      onDelete,
      onToggleEnabled,
      canUpdate,
      canDelete,
      profileId,
      isCompanyAdmin,
      previewMap,
    ],
  );
  return (
    <DataTable
      className="files-workspace-table"
      columns={columns}
      data={files}
      manualPagination
      showToolbar={false}
      showPagination={false}
    />
  );
}
