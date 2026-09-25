import {
  X, Loader2, AlertCircle, Mic, Play, FileText, FileType2, FileSpreadsheet,
  FileImage, FileVideo, FileAudio, FileArchive, FileCode, File as FileIcon,
} from "lucide-react";
import { formatFileSize } from "../lib/chatUtils";

// Extracted from MessageComposer.jsx (pure move, no behavior change) — see
// docs/TASKS.md "Chat UI polish — Sub-project 3" for the precedent
// (ChatMessageBubble.jsx -> MessageAttachments.jsx) this extraction follows.

function fileTypeIcon(mimeType) {
  const m = String(mimeType ?? "").toLowerCase();
  if (m.startsWith("image/"))   return <FileImage className="h-5 w-5 text-blue-400" />;
  if (m.startsWith("video/"))   return <FileVideo className="h-5 w-5 text-orange-400" />;
  if (m.startsWith("audio/"))   return <FileAudio className="h-5 w-5 text-emerald-400" />;
  if (m === "application/pdf")  return <FileText className="h-5 w-5 text-red-400" />;
  if (m.includes("spreadsheet") || m.includes("excel")) return <FileSpreadsheet className="h-5 w-5 text-green-400" />;
  if (m.includes("word") || m.includes("document"))     return <FileType2 className="h-5 w-5 text-blue-400" />;
  if (m.includes("zip") || m.includes("archive") || m.includes("compressed")) return <FileArchive className="h-5 w-5 text-yellow-400" />;
  if (m.startsWith("text/"))    return <FileCode className="h-5 w-5 text-purple-400" />;
  return <FileIcon className="h-5 w-5 text-[hsl(var(--muted-foreground))]" />;
}

function RemoveBtn({ onClick }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="absolute top-1 right-1 h-5 w-5 rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center transition-colors touch-manipulation z-10"
      aria-label="Quitar"
    >
      <X className="h-3 w-3 text-white" />
    </button>
  );
}

function StatusOverlay({ uploading, error }) {
  if (uploading) return (
    <div className="absolute inset-0 bg-black/40 flex items-center justify-center rounded-xl pointer-events-none">
      <Loader2 className="h-4 w-4 animate-spin text-white" />
    </div>
  );
  if (error) return (
    <div className="absolute inset-0 bg-red-500/40 flex items-center justify-center rounded-xl pointer-events-none">
      <AlertCircle className="h-4 w-4 text-white" />
    </div>
  );
  return null;
}

export function AttachmentPreviewCard({ entry, onRemove, onOpen, onRetry }) {
  const mime = entry.file.type;
  const isImage = mime.startsWith("image/");
  const isVideo = mime.startsWith("video/");
  const isAudio = mime.startsWith("audio/");

  // Shared props that turn a card body into a "ver archivo" click target.
  const openProps = {
    role: "button",
    tabIndex: 0,
    "aria-label": "Ver archivo",
    onClick: () => onOpen?.(entry),
    onKeyDown: (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen?.(entry); }
    },
  };

  // ── Image thumbnail ──────────────────────────────────────────────────────
  if (isImage && entry.objectUrl) {
    return (
      <div {...openProps} className="relative h-20 w-20 rounded-xl overflow-hidden shrink-0 bg-[hsl(var(--muted))] cursor-pointer">
        <img src={entry.objectUrl} alt="" className="h-full w-full object-cover" />
        <StatusOverlay uploading={entry.uploading} error={entry.error} />
        <RemoveBtn onClick={() => onRemove(entry.localId)} />
      </div>
    );
  }

  // ── Video thumbnail ──────────────────────────────────────────────────────
  if (isVideo) {
    return (
      <div {...openProps} className="relative h-20 w-20 rounded-xl overflow-hidden shrink-0 bg-black/25 cursor-pointer">
        {entry.objectUrl && (
          <video
            src={`${entry.objectUrl}#t=0.001`}
            preload="auto"
            muted
            playsInline
            className="h-full w-full object-cover"
          />
        )}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="h-7 w-7 rounded-full bg-black/55 flex items-center justify-center">
            <Play className="h-3.5 w-3.5 text-white fill-white ml-0.5" />
          </div>
        </div>
        <StatusOverlay uploading={entry.uploading} error={entry.error} />
        <RemoveBtn onClick={() => onRemove(entry.localId)} />
      </div>
    );
  }

  // ── Audio / voice note ───────────────────────────────────────────────────
  if (isAudio) {
    return (
      <div className="relative flex items-center gap-2.5 bg-[hsl(var(--muted))] rounded-xl px-3 py-2.5 shrink-0 pr-8" style={{ maxWidth: 200 }}>
        <div className="h-8 w-8 rounded-full bg-emerald-500/15 flex items-center justify-center shrink-0">
          <Mic className="h-4 w-4 text-emerald-500" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium leading-tight">Nota de voz</p>
          <p className="text-[10px] text-[hsl(var(--muted-foreground))] leading-tight">
            {formatFileSize(entry.file.size)}
            {entry.uploading && " · Subiendo..."}
            {entry.error && (
              // Full message in `title` (long-press/hover) — the composer
              // used to swallow it into a bare "Error", which made an
              // iOS-only upload failure impossible to diagnose remotely.
              <span className="text-red-500" title={entry.error}> · Error</span>
            )}
          </p>
          {entry.error && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onRetry?.(); }}
              className="mt-0.5 text-[10px] font-medium text-primary underline underline-offset-2"
            >
              Reintentar
            </button>
          )}
        </div>
        <RemoveBtn onClick={() => onRemove(entry.localId)} />
      </div>
    );
  }

  // ── Generic file ─────────────────────────────────────────────────────────
  return (
    <div {...openProps} className="relative flex items-center gap-2.5 bg-[hsl(var(--muted))] rounded-xl px-3 py-2.5 shrink-0 pr-8 cursor-pointer" style={{ maxWidth: 200 }}>
      <div className="h-8 w-8 rounded-full bg-[hsl(var(--border))] flex items-center justify-center shrink-0">
        {fileTypeIcon(mime)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium truncate leading-tight">{entry.file.name}</p>
        <p className="text-[10px] text-[hsl(var(--muted-foreground))] leading-tight">
          {formatFileSize(entry.file.size)}
          {entry.uploading && " · Subiendo..."}
          {entry.error && <span className="text-red-500"> · Error</span>}
        </p>
      </div>
      <RemoveBtn onClick={() => onRemove(entry.localId)} />
    </div>
  );
}
