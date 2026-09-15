import {
  File,
  FileArchive,
  FileAudio,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileType2,
  FileVideo,
  Presentation,
} from "lucide-react";
import { getFileKind, getKindAccent } from "../lib/file-kind";

function getKindIcon(kind) {
  if (kind === "image") return FileImage;
  if (kind === "video") return FileVideo;
  if (kind === "audio") return FileAudio;
  if (kind === "pdf") return FileType2;
  if (kind === "csv" || kind === "sheet") return FileSpreadsheet;
  if (kind === "presentation") return Presentation;
  if (kind === "archive") return FileArchive;
  if (kind === "doc" || kind === "text") return FileText;
  return File;
}

export function FileVisual({ file, previewUrl, className = "", onClick = null }) {
  const kind = getFileKind(file);
  const Icon = getKindIcon(kind);
  const accent = getKindAccent(kind);

  if (kind === "image" && previewUrl) {
    return (
      <img
        src={previewUrl}
        alt={file?.originalName ?? "Archivo"}
        className={`${className || "h-10 w-10 rounded object-cover"} ${onClick ? "cursor-pointer" : ""}`}
        onClick={onClick}
      />
    );
  }

  return (
    <div
      className={`h-10 w-10 rounded flex items-center justify-center ${className} ${onClick ? "cursor-pointer" : ""}`}
      style={{
        color: accent,
        backgroundColor: `color-mix(in srgb, ${accent} 12%, transparent)`,
      }}
      onClick={onClick}
      onKeyDown={(event) => {
        if (!onClick) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick(event);
        }
      }}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <Icon className="h-5 w-5" />
    </div>
  );
}
