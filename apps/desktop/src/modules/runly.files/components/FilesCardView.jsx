import {
  Badge,
  Button,
  Card,
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
  Eye,
  ExternalLink,
  Link2,
  Pencil,
  Trash2,
} from "lucide-react";

export function FilesCardView({
  files,
  selectedSet,
  onToggleSelect,
  onPreview,
  onDownload,
  onCopyLink,
  onRename,
  onDetail,
  onDelete,
  previewMap,
  isAdmin,
}) {
  return (
    <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
      {files.map((file) => (
        <Card key={file.id} className="p-4 space-y-3">
          <div className="flex items-start gap-3">
            <button
              type="button"
              onClick={() => onToggleSelect(file.id)}
              className={`h-5 w-5 rounded border mt-1 transition-colors ${
                selectedSet.has(file.id)
                  ? "bg-(--brand-primary) border-(--brand-primary)"
                  : "border-[hsl(var(--border))]"
              }`}
            />
            <FileVisual
              file={file}
              previewUrl={previewMap.get(file.id)}
              className="h-12 w-12 rounded-md object-cover bg-[hsl(var(--muted))]"
              onClick={() => onPreview(file)}
            />
            <div className="min-w-0">
              <p
                className="font-medium text-sm truncate cursor-pointer"
                onClick={() => onPreview(file)}
              >
                {file.originalName}
              </p>
              <div className="mt-0.5">
                {(() => {
                  const kind = getFileKind(file);
                  return (
                    <TypeBadge accent={getKindAccent(kind)}>
                      {getKindLabel(kind)}
                    </TypeBadge>
                  );
                })()}
              </div>
              <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
                {formatBytes(file.sizeBytes)} · {formatDate(file.createdAt)}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant={file.enabled ? "success" : "secondary"}>
              {file.enabled ? "Activo" : "Deshabilitado"}
            </Badge>
            <Badge variant="outline">{file.moduleKey || "runly.files"}</Badge>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => onPreview(file)}>
              <Eye className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onDownload(file)}>
              <Download className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onCopyLink(file)}>
              <Link2 className="h-3.5 w-3.5" />
            </Button>
            {isAdmin && (
              <Button size="sm" variant="ghost" onClick={() => onRename(file)}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            )}
            {isAdmin && (
              <Button
                size="sm"
                variant="ghost"
                className="text-[hsl(var(--destructive))] hover:text-[hsl(var(--destructive))]"
                onClick={() => onDelete(file)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => onDetail(file)}>
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}
