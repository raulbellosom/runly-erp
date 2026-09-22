import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ConfirmDialog, EmptyState, ErrorState, Skeleton,
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@runly/ui";
import { Loader2, AlertCircle, Play, Trash2, Video } from "lucide-react";
import { toast } from "sonner";
import { useConversationRecordings, useDeleteRecording } from "../hooks/useConversationRecordings";

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

// Attaches `src` (a blob: URL wrapping the rewritten HLS manifest — see
// RecordingRow's manifestBlobUrl) to the given video ref: native
// playback on Safari (which supports HLS natively), the hls.js polyfill
// (lazy-loaded so it never enters the main bundle) everywhere else.
// A real useEffect is required here (not useState's lazy initializer,
// which only ever runs once at mount) because `src` only becomes non-null
// after the row is expanded post-mount — the effect must re-run then.
// `onFatalError` is invoked for hls.js fatal errors (network/media errors
// that hls.js itself can't recover from) — the native-Safari path relies on
// the `<video>` element's own `onError` prop instead (wired by the caller),
// since hls.js's event bus doesn't apply there.
function useHls(videoRef, src, onFatalError) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(false);
    if (!src || !videoRef.current) return undefined;
    const video = videoRef.current;

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
      setReady(true);
      return () => {
        // Symmetric with the hls.js branch's hls.destroy() below — stops
        // playback and releases the media resource on cleanup instead of
        // relying solely on the <video> node being unmounted.
        video.pause();
        video.removeAttribute("src");
        video.load();
      };
    }

    let hls;
    let cancelled = false;
    import("hls.js").then(({ default: Hls }) => {
      if (cancelled) return;
      if (!Hls.isSupported()) {
        onFatalError?.();
        return;
      }
      hls = new Hls();
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data?.fatal) onFatalError?.();
      });
      hls.loadSource(src);
      hls.attachMedia(video);
      setReady(true);
    });

    return () => {
      cancelled = true;
      hls?.destroy();
    };
  }, [src, videoRef, onFatalError]);

  return ready;
}

function RecordingRow({ recording, refetch, deleteRecording }) {
  const [expanded, setExpanded] = useState(false);
  const [playbackError, setPlaybackError] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const videoRef = useRef(null);
  // Same one-retry-then-give-up convention as MessageAttachments.jsx's
  // AudioCard: on the first playback error, refetch the recordings list
  // (each segment's signed URL, baked into the manifest, has a 1-hour TTL,
  // so a panel left open past that gets a fresh manifest) and let the
  // effect above reattach with it; if it still fails, stop retrying and
  // show an inline error instead of silently leaving a broken/blank player.
  const retriedRef = useRef(false);

  const handleFatalError = useCallback(() => {
    if (!retriedRef.current) {
      retriedRef.current = true;
      refetch?.();
      return;
    }
    setPlaybackError(true);
  }, [refetch]);

  // The backend hands us the rewritten manifest text (every segment line
  // replaced with its own signed URL — see call-recording-service.js
  // listRecordings/signManifestSegments), not a fetchable URL: a signed URL
  // for the .m3u8 alone doesn't work, since hls.js/native HLS resolve each
  // segment's bare relative filename against it and drop its signing token.
  // A blob: URL lets hls.js (and Safari's native HLS engine) load that text
  // as if it were a normal manifest fetch.
  const hasPlaylist = Boolean(recording.playlistManifest);
  const manifestBlobUrl = useMemo(() => {
    if (!recording.playlistManifest) return null;
    return URL.createObjectURL(new Blob([recording.playlistManifest], { type: "application/vnd.apple.mpegurl" }));
  }, [recording.playlistManifest]);
  useEffect(() => () => { if (manifestBlobUrl) URL.revokeObjectURL(manifestBlobUrl); }, [manifestBlobUrl]);

  useHls(videoRef, expanded && manifestBlobUrl ? manifestBlobUrl : null, handleFatalError);

  function toggleExpanded() {
    setExpanded((wasExpanded) => {
      const next = !wasExpanded;
      if (next) {
        // Fresh attempt each time the row is (re-)opened.
        retriedRef.current = false;
        setPlaybackError(false);
      }
      return next;
    });
  }

  const isReady = recording.status === "READY";
  const isFailed = recording.status === "FAILED";
  const isActive = ["STARTING", "ACTIVE", "PROCESSING"].includes(recording.status);
  // The backend only fills playlistManifest when it could read the .m3u8 and
  // sign every segment it references (call-recording-service.js
  // listRecordings) — a READY recording can still have no manifest if any of
  // that failed.
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
          <p className="truncate text-sm font-medium">{formatRecordingDateTime(recording.startedAt)}</p>
          <p className="truncate text-xs text-[hsl(var(--muted-foreground))]">{metaParts.join(" · ")}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {isReady && hasPlaylist && (
            <button
              type="button"
              onClick={toggleExpanded}
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
      {expanded && isReady && hasPlaylist && (
        playbackError ? (
          <div className="mt-2 flex items-center gap-2 rounded-lg bg-[hsl(var(--muted))] px-3 py-2 text-xs text-[hsl(var(--muted-foreground))]">
            <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />
            No se pudo reproducir la grabación.
          </div>
        ) : (
          // react-doctor-disable-next-line media-has-caption -- internal call recording, no captions track produced by Egress.
          <video ref={videoRef} controls onError={handleFatalError} className="mt-2 w-full rounded-lg bg-black" />
        )
      )}
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
  const recordings = data?.data ?? data ?? [];

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
        <RecordingRow key={r.id} recording={r} refetch={refetch} deleteRecording={deleteRecording} />
      ))}
    </div>
  );
}
