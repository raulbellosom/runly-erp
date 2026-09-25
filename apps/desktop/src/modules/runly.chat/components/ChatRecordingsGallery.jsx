import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AdvancedFileViewer, ConfirmDialog, EmptyState, ErrorState, Input, Skeleton,
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger, useCoarsePointer,
} from "@runly/ui";
import { AlertCircle, Check, Loader2, Pencil, Play, Trash2, Video, X } from "lucide-react";
import { toast } from "sonner";
import { useConversationRecordings, useDeleteRecording, useRenameRecording } from "../hooks/useConversationRecordings";
import { useConversationTranscripts } from "../hooks/useConversationTranscripts";
import { RecordingTranscriptAction } from "./RecordingTranscriptAction";

// Always shows the full date, unlike chatUtils' formatMessageTime (which
// collapses "today" down to just a time) — recordings are reviewed well
// after the fact and several can share a day, so the date is load-bearing
// here, not just decoration.
function formatRecordingDateTime(dateStr) {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleString("es-MX", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function formatFileSize(bytes) {
  if (bytes == null) return null;
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex > 0 && value < 10 ? 1 : 0)} ${units[unitIndex]}`;
}

// Click the pencil to edit in place; Enter/blur saves, Escape cancels. An
// empty/whitespace-only save clears the custom title back to the default
// date/time label (renameRecording treats that the same way server-side).
function RecordingTitle({ recording, renameRecording }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(recording.title ?? "");
  const inputRef = useRef(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  function startEditing() {
    setDraft(recording.title ?? "");
    setEditing(true);
  }

  async function save() {
    const next = draft.trim();
    if (next === (recording.title ?? "").trim()) { setEditing(false); return; }
    try {
      await renameRecording.mutateAsync({ recordingId: recording.id, title: next });
      setEditing(false);
    } catch (err) {
      toast.error(err?.message ?? "No se pudo renombrar la grabación.");
    }
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <Input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            else if (e.key === "Escape") setEditing(false);
          }}
          maxLength={120}
          placeholder={formatRecordingDateTime(recording.startedAt)}
          className="h-7 text-sm"
        />
        <button
          type="button"
          onClick={save}
          disabled={renameRecording.isPending}
          title="Guardar"
          aria-label="Guardar nombre"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary)/0.1)]"
        >
          <Check className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          title="Cancelar"
          aria-label="Cancelar"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  // On touch devices there is no hover, so a hover-only reveal would leave
  // the pencil permanently invisible there — same fix already applied to
  // the speak button elsewhere in runly.chat (useCoarsePointer).
  const coarse = useCoarsePointer();
  const revealCls = coarse ? "opacity-100" : "opacity-0 group-hover/title:opacity-100 focus-visible:opacity-100";

  return (
    <div className="group/title flex items-center gap-1.5 min-w-0">
      <p className="truncate text-sm font-medium">{recording.title || formatRecordingDateTime(recording.startedAt)}</p>
      <button
        type="button"
        onClick={startEditing}
        title="Renombrar"
        aria-label="Renombrar grabación"
        className={`${revealCls} flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] transition-opacity`}
      >
        <Pencil className="h-3 w-3" />
      </button>
    </div>
  );
}

function RecordingRow({ recording, deleteRecording, renameRecording, onPlay, transcript, conversationId }) {
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const isReady = recording.status === "READY";
  const isFailed = recording.status === "FAILED";
  const isActive = ["STARTING", "ACTIVE", "PROCESSING"].includes(recording.status);
  // The backend only fills playlistManifest when it could read the .m3u8 and
  // sign every segment it references (call-recording-service.js
  // listRecordings) — a READY recording can still have no manifest if any of
  // that failed.
  const hasPlaylist = Boolean(recording.playlistManifest);
  const isUnavailable = isReady && !hasPlaylist;
  // The real reason, when the backend has one: failureReason is persisted on
  // FAILED rows (call-recording-service.js startRecording/reconcileActiveRecordings);
  // playlistUrlError is computed live on every listRecordings call for a READY
  // row whose manifest read/segment signing failed. Falls back to a generic message for
  // older rows recorded before this field existed.
  const errorDetail = isFailed
    ? (recording.failureReason || "No se pudo procesar la grabación.")
    : isUnavailable
      ? (recording.playlistUrlError || "No se pudo generar el enlace de reproducción.")
      : null;

  // When there's a problem, lead with it instead of duration/size — a "13s ·
  // 5.3 MB" subtitle next to a warning icon told the user nothing was wrong
  // beyond a vague icon (the bug reported: recordings with a real S3 object
  // and real metadata still can't be signed into a playable URL).
  const metaParts = [];
  // The date is the primary title when there's no custom name — once a
  // recording is renamed, it would otherwise disappear from the row entirely.
  if (recording.title) metaParts.push(formatRecordingDateTime(recording.startedAt));
  if (errorDetail) {
    metaParts.push(errorDetail);
  } else {
    if (isReady && recording.durationMs != null) metaParts.push(`${Math.round(recording.durationMs / 1000)}s`);
    const fileSize = isReady ? formatFileSize(recording.sizeBytes) : null;
    if (fileSize) metaParts.push(fileSize);
  }
  if (recording.startedBy?.displayName) metaParts.push(`Por ${recording.startedBy.displayName}`);
  if (!metaParts.length) metaParts.push("Procesando...");

  async function handleDelete() {
    try {
      await deleteRecording.mutateAsync(recording.id);
      setConfirmDeleteOpen(false);
    } catch (err) {
      toast.error(err?.message ?? "No se pudo eliminar la grabación.");
    }
  }

  return (
    <div className="rounded-xl border border-[hsl(var(--border))] p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <RecordingTitle recording={recording} renameRecording={renameRecording} />
          <p className="truncate text-xs text-[hsl(var(--muted-foreground))]">{metaParts.join(" · ")}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {isReady && hasPlaylist && (
            <button
              type="button"
              onClick={() => onPlay(recording)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--primary)/0.1)] text-[hsl(var(--primary))]"
              aria-label="Reproducir"
            >
              <Play className="h-4 w-4" />
            </button>
          )}
          {(isFailed || isUnavailable) && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <AlertCircle
                    className={`h-5 w-5 shrink-0 ${isFailed ? "text-red-500" : "text-amber-500"}`}
                    aria-label={errorDetail}
                  />
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs text-xs">
                  {errorDetail}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {!isReady && !isFailed && (
            <Loader2 className="h-5 w-5 shrink-0 animate-spin text-[hsl(var(--muted-foreground))]" aria-label="Procesando" />
          )}
          {isReady && (
            <RecordingTranscriptAction recording={recording} transcript={transcript} conversationId={conversationId} />
          )}
          {!isActive && (
            <button
              type="button"
              onClick={() => setConfirmDeleteOpen(true)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[hsl(var(--muted-foreground))] hover:bg-red-500/10 hover:text-red-500"
              aria-label="Eliminar grabación"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        title="Eliminar grabación"
        description="Esta acción no se puede deshacer. El archivo de video (si existe) se borrará permanentemente."
        confirmLabel="Eliminar"
        loading={deleteRecording.isPending}
        onConfirm={handleDelete}
      />
    </div>
  );
}

export function ChatRecordingsGallery({ conversationId }) {
  const { data, isLoading, isError, refetch } = useConversationRecordings(conversationId);
  const deleteRecording = useDeleteRecording(conversationId);
  const renameRecording = useRenameRecording(conversationId);
  const recordings = data?.data ?? data ?? [];
  const { data: transcriptsData } = useConversationTranscripts(conversationId);
  const transcriptsByRecordingId = useMemo(() => {
    const map = new Map();
    for (const t of (transcriptsData?.data ?? transcriptsData ?? [])) {
      if (t.recordingId) map.set(t.recordingId, t);
    }
    return map;
  }, [transcriptsData]);
  // Only playable recordings are browsable in the viewer — FAILED/processing/
  // unavailable rows have nothing to show and stay as their own row with a
  // warning icon on the list side (see RecordingRow's errorDetail).
  const playableRecordings = useMemo(
    () => recordings.filter((r) => r.status === "READY" && r.playlistManifest),
    [recordings],
  );

  // Reuses the same viewer the files module opens for images/PDF/audio/video
  // (AdvancedFileViewer, in @runly/ui) instead of a bespoke inline player —
  // same chrome, zoom/fullscreen, native controls, and (since every playable
  // recording of the conversation is passed in, not just the one clicked)
  // the same prev/next filmstrip navigation as any other multi-file gallery.
  // It only knows how to ask for "a signed URL" per file, so each recording's
  // HLS manifest (rewritten with signed segment URLs — see
  // call-recording-service.js) is wrapped in its own blob: URL here and
  // handed back as if it were one; useHlsPlayback (@runly/ui) handles the
  // actual hls.js attachment once the viewer renders the <video>.
  const [viewerIndex, setViewerIndex] = useState(null);
  // recordingId -> blob url, so paging back to an already-viewed recording
  // (A -> B -> A) doesn't rebuild the Blob, and every entry can be revoked on close.
  const blobUrlCacheRef = useRef(new Map());

  const viewerFiles = useMemo(() => playableRecordings.map((r) => ({
    id: r.id,
    mimeType: "application/vnd.apple.mpegurl",
    originalName: r.title || `Grabación ${formatRecordingDateTime(r.startedAt)}`,
    sizeBytes: r.sizeBytes,
  })), [playableRecordings]);

  const resolveRecordingUrl = useCallback(async (file) => {
    const cached = blobUrlCacheRef.current.get(file.id);
    if (cached) return cached;
    const recording = playableRecordings.find((r) => r.id === file.id);
    if (!recording?.playlistManifest) return null;
    const url = URL.createObjectURL(new Blob([recording.playlistManifest], { type: "application/vnd.apple.mpegurl" }));
    blobUrlCacheRef.current.set(file.id, url);
    return url;
  }, [playableRecordings]);

  function handlePlay(recording) {
    const idx = playableRecordings.findIndex((r) => r.id === recording.id);
    if (idx >= 0) setViewerIndex(idx);
  }

  const closeViewer = useCallback((nextOpen) => {
    if (nextOpen) return;
    for (const url of blobUrlCacheRef.current.values()) URL.revokeObjectURL(url);
    blobUrlCacheRef.current.clear();
    setViewerIndex(null);
  }, []);

  if (isLoading) {
    return (
      <div className="space-y-2 p-3">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex-1 min-h-0 p-3">
        <ErrorState title="No se pudieron cargar las grabaciones" onRetry={refetch} />
      </div>
    );
  }

  if (!recordings.length) {
    return (
      <EmptyState
        className="flex-1 min-h-0"
        icon={Video}
        title="Aún no hay grabaciones"
        description="Las grabaciones de las llamadas de esta conversación aparecerán aquí."
      />
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto space-y-2 p-3">
      {recordings.map((r) => (
        <RecordingRow
          key={r.id}
          recording={r}
          deleteRecording={deleteRecording}
          renameRecording={renameRecording}
          onPlay={handlePlay}
          transcript={transcriptsByRecordingId.get(r.id)}
          conversationId={conversationId}
        />
      ))}
      <AdvancedFileViewer
        open={viewerIndex !== null}
        onOpenChange={closeViewer}
        files={viewerFiles}
        activeIndex={viewerIndex ?? 0}
        onIndexChange={setViewerIndex}
        onResolveSignedUrl={resolveRecordingUrl}
        zIndex={10000}
      />
    </div>
  );
}
