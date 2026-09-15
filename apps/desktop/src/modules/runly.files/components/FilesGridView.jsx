import {
  Button,
  TypeBadge,
  FileVisual,
  getFileKind,
  getKindLabel,
  getKindAccent,
} from "@runly/ui";
import { Download, Eye, Trash2 } from "lucide-react";

export function FilesGridView({
  files,
  previewMap,
  selectedSet,
  onToggleSelect,
  onPreview,
  onDownload,
  onDetail,
  onDelete,
  isAdmin,
}) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
      {files.map((file) => (
        <div
          key={file.id}
          onClick={() => onDetail(file)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onDetail(file);
            }
          }}
          role="button"
          tabIndex={0}
          className={`rounded-xl border p-2 text-left transition-colors ${
            selectedSet.has(file.id)
              ? "border-(--brand-primary) bg-(--brand-soft)"
              : "border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/30"
          }`}
        >
          <div className="relative">
            <FileVisual
              file={file}
              previewUrl={previewMap.get(file.id)}
              className="h-28 w-full rounded-lg object-cover bg-[hsl(var(--muted))]"
              onClick={(event) => {
                event.stopPropagation();
                onPreview(file);
              }}
            />
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onToggleSelect(file.id);
              }}
              className={`absolute right-2 top-2 h-5 w-5 rounded border ${
                selectedSet.has(file.id)
                  ? "bg-(--brand-primary) border-(--brand-primary)"
                  : "bg-white/80 border-white/70"
              }`}
            />
          </div>
          <div className="mt-2">
            <p
              className="text-xs font-medium truncate cursor-pointer"
              onClick={(event) => {
                event.stopPropagation();
                onPreview(file);
              }}
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
          </div>
          <div className="mt-2 flex items-center gap-1">
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={(event) => {
                event.stopPropagation();
                onPreview(file);
              }}
            >
              <Eye className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={(event) => {
                event.stopPropagation();
                onDownload(file);
              }}
            >
              <Download className="h-3.5 w-3.5" />
            </Button>
            {isAdmin && (
              <Button
                size="icon-sm"
                variant="ghost"
                className="text-[hsl(var(--destructive))] hover:text-[hsl(var(--destructive))]"
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete(file);
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
