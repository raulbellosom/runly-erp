import { useState, useRef, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Loader2, Download, Play, Pause, Mic, AlertCircle,
  FileText, FileType2, FileSpreadsheet, FileImage, FileVideo, FileAudio,
  FileArchive, FileCode, File, Trash2, Smile,
  Copy, Link2, ExternalLink, FilePenLine,
} from "lucide-react";
import {
  ConfirmDialog,
  useCoarsePointer,
  useOfficeActions,
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@runly/ui";
import { formatFileSize, isImageMime, isAudioAttachment } from "../lib/chatUtils";
import { isOfficeOpenable } from "../lib/officeFileActions";
import { runly } from "../../../lib/runly";
import { useAuth } from "../../../auth/AuthProvider";
import { MessageReactionPicker } from "./MessageReactionPicker";
import { isSignedUrlUsable } from "../lib/signedUrl";

function isVideoMime(m) { return String(m ?? "").startsWith("video/"); }
function getFileTypeInfo(mimeType = "") {
  const m = String(mimeType).toLowerCase();
  if (m === "application/pdf") return { Icon: FileType2, colorClass: "text-red-400" };
  if (m.includes("spreadsheet") || m.includes("excel") || m === "text/csv")
    return { Icon: FileSpreadsheet, colorClass: "text-green-400" };
  if (m.includes("word") || m.includes("document"))
    return { Icon: FileText, colorClass: "text-blue-400" };
  if (m.startsWith("image/")) return { Icon: FileImage, colorClass: "text-violet-400" };
  if (m.startsWith("video/")) return { Icon: FileVideo, colorClass: "text-orange-400" };
  if (m.startsWith("audio/")) return { Icon: FileAudio, colorClass: "text-emerald-400" };
  if (m.includes("zip") || m.includes("rar") || m.includes("tar") || m.includes("7z"))
    return { Icon: FileArchive, colorClass: "text-yellow-400" };
  if (m.startsWith("text/") || m.includes("json") || m.includes("xml"))
    return { Icon: FileCode, colorClass: "text-cyan-400" };
  return { Icon: File, colorClass: "text-[hsl(var(--muted-foreground))]" };
}

// Embedded URLs provide an immediate preview; refetch always asks the API for
// a current URL, including after a failed playback or restoring persisted cache.
export function useAttachmentUrl(att) {
  const { session } = useAuth();
  const embeddedUrl = isSignedUrlUsable(att?.url) ? att.url : null;
  return useQuery({
    queryKey: ["chat-attachment-url", att?.id],
    queryFn: async () => {
      if (att?.url?.startsWith("blob:")) return att.url;
      try {
        const res = await runly.chat.getAttachmentSignedUrl(att.id, session?.access_token);
        return res?.data?.url ?? null;
      } catch (err) {
        console.warn("[chat] getAttachmentSignedUrl failed", { id: att?.id, status: err?.status, msg: err?.message });
        throw err;
      }
    },
    // Seed the cache with the embedded URL so it resolves synchronously
    initialData: embeddedUrl ?? undefined,
    // Validate persisted cache on mount and keep long-lived conversations fresh.
    staleTime: 0,
    refetchInterval: 4 * 60 * 1000,
    retry: 2,
    enabled: Boolean(att?.id && session?.access_token),
  });
}

// Media-tile actions (copy image / copy link / download / open) as a plain
// list, merged into the unified message menu (MessageActionSheet) so an image
// or file message shows BOTH its message actions and these. `url` may be null
// (still resolving) — those entries render disabled.
export function buildAttachmentActions({ att, url, office }) {
  if (!att) return [];
  const isImage = isImageMime(att.mimeType);
  const items = [];
  if (
    office?.enabled &&
    isOfficeOpenable({ fileName: att.fileName, mimeType: att.mimeType })
  ) {
    items.push({
      key: "att-office",
      label: office.canEdit ? "Abrir en editor de Office" : "Abrir en Office (solo lectura)",
      icon: FilePenLine,
      onSelect: () => office.openChatAttachment(att.id),
    });
  }
  if (isImage) {
    items.push({
      key: "att-copy-image", label: "Copiar imagen", icon: Copy, disabled: !url,
      onSelect: async () => {
        if (!url) return;
        try { await copyImageToClipboard(url); toast.success("Imagen copiada"); }
        catch {
          try { await navigator.clipboard?.writeText(url); toast.message("No se pudo copiar la imagen — se copió el enlace"); }
          catch { toast.error("No se pudo copiar"); }
        }
      },
    });
  }
  items.push({
    key: "att-copy-link", label: "Copiar enlace", icon: Link2, disabled: !url,
    onSelect: async () => {
      if (!url) return;
      try { await navigator.clipboard?.writeText(url); toast.success("Enlace copiado"); }
      catch { toast.error("No se pudo copiar el enlace"); }
    },
  });
  items.push({
    key: "att-download", label: "Descargar", icon: Download, disabled: !url,
    onSelect: () => url && downloadAttachment(url, att.fileName),
  });
  items.push({
    key: "att-open", label: "Abrir en pestaña nueva", icon: ExternalLink, disabled: !url,
    onSelect: () => url && window.open(url, "_blank", "noopener,noreferrer"),
  });
  return items;
}

// ── Right-click quick actions for a media tile ────────────────────────────────
// Wraps any attachment tile (image / video / generic file) so a right-click or
// long-press offers "copiar imagen / copiar enlace / descargar / abrir" —
// matching what people expect from images and PDFs elsewhere.
async function copyImageToClipboard(url) {
  const res = await fetch(url);
  const blob = await res.blob();
  let out = blob;
  // Most browsers only accept image/png on the clipboard — re-encode anything
  // else (jpeg/webp) through a canvas first.
  if (blob.type !== "image/png" && typeof createImageBitmap === "function") {
    const bmp = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    canvas.getContext("2d").drawImage(bmp, 0, 0);
    out = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    bmp.close?.();
  }
  if (!out || !navigator.clipboard?.write) throw new Error("clipboard-unavailable");
  await navigator.clipboard.write([new window.ClipboardItem({ [out.type || "image/png"]: out })]);
}

function downloadAttachment(url, fileName) {
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName ?? "archivo";
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.click();
}

// ── Per-tile action icons (react + delete) ─────────────────────────────────
// Shared by every grid cell type (ImageCard, ImageCoverCell, VideoCard) so
// the hover affordance, the reaction picker anchor, and the delete confirm
// flow are defined exactly once. `messageId` + `att.id` together identify
// which reaction/deletion this targets — never the whole message.
function AttachmentTileActions({ att, messageId, isOwn, onToggleReaction, onDeleteAttachment, deleting }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const coarse = useCoarsePointer();

  if (!onToggleReaction && !(isOwn && onDeleteAttachment)) return null;

  return (
    <>
      {/* stopPropagation on the wrapper (not each button) so a click on
          either icon never also fires the tile's own onClick={() => onOpen(...)},
          which would open the full-screen viewer underneath the picker/dialog. */}
      <div
        className={[
          "absolute top-1 right-1 flex items-center gap-1 transition-opacity z-10",
          coarse ? "opacity-100" : "opacity-60 sm:opacity-0 sm:group-hover:opacity-100",
        ].join(" ")}
        onClick={(e) => e.stopPropagation()}
      >
        {onToggleReaction && (
          <MessageReactionPicker
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            onPick={(emoji) => onToggleReaction(messageId, emoji, att.id)}
            anchorAlign={isOwn ? "end" : "start"}
          >
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="h-6 w-6 rounded-full bg-black/50 hover:bg-black/70 flex items-center justify-center transition-colors touch-manipulation"
              aria-label="Reaccionar a este archivo"
              title="Reaccionar"
            >
              <Smile className="h-3.5 w-3.5 text-white" />
            </button>
          </MessageReactionPicker>
        )}
        {isOwn && onDeleteAttachment && (
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            className="h-6 w-6 rounded-full bg-black/50 hover:bg-black/70 flex items-center justify-center transition-colors touch-manipulation"
            aria-label="Eliminar este archivo"
            title="Eliminar"
          >
            <Trash2 className="h-3.5 w-3.5 text-white" />
          </button>
        )}
      </div>
      {isOwn && onDeleteAttachment && (
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title="Eliminar archivo"
          description="Esta accion no se puede deshacer."
          confirmLabel="Eliminar"
          loading={deleting}
          onConfirm={() => { onDeleteAttachment(att.id); setConfirmOpen(false); }}
        />
      )}
    </>
  );
}

// ── Per-tile reaction pills ──────────────────────────────────────────────────
// Smaller, simpler sibling of MessageReactions.jsx: no "who reacted" modal
// (there isn't room for it inside a ~110px tile) — clicking a pill you
// reacted with removes it directly; clicking one you didn't react with does
// nothing (view-only for other people's reactions on this small surface).
function AttachmentReactionPills({ reactions, currentUserId, onToggleReaction, messageId, attachmentId }) {
  if (!reactions?.length) return null;
  return (
    <div
      className="absolute bottom-1 left-1 flex flex-wrap gap-0.5 z-10"
      onClick={(e) => e.stopPropagation()}
    >
      {reactions.map(({ emoji, userIds }) => {
        const mine = currentUserId && userIds?.includes(currentUserId);
        return (
          <button
            key={emoji}
            type="button"
            onClick={() => mine && onToggleReaction?.(messageId, emoji, attachmentId)}
            className={[
              "inline-flex items-center gap-0.5 px-1 py-0.5 rounded-full text-[10px] bg-black/60 text-white",
              mine ? "ring-1 ring-white cursor-pointer" : "cursor-default",
            ].join(" ")}
          >
            <span>{emoji}</span>
            <span className="tabular-nums">{userIds?.length ?? 0}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── Image card ────────────────────────────────────────────────────────────────
// A single image renders inside a bounded, more-square preview box: its display
// aspect ratio is clamped to [3:4 … 4:3]. A very tall screenshot shows as a 3:4
// box (top/bottom cropped by object-cover), a panorama as 4:3, anything in
// between at its true ratio. The full, uncropped image is shown in the viewer.
const THUMB_MIN_RATIO = 3 / 4;   // tallest allowed (portrait)
const THUMB_MAX_RATIO = 4 / 3;   // widest allowed (landscape)

function ImageCard({ att, index, allAttachments, onOpen, messageId, isOwn, currentUserId, onToggleReaction, onDeleteAttachment, deletingAttachmentId, merged = false }) {
  const { data: url, isLoading } = useAttachmentUrl(att);
  const [failedUrl, setFailedUrl] = useState(null);
  const [ratio, setRatio] = useState(null);
  const rounded = merged ? "" : "rounded-xl";
  const boxRatio = ratio ?? THUMB_MIN_RATIO;

  return (
    <div data-attachment-id={att.id} className={["relative group block overflow-hidden", rounded].join(" ")} style={{ minHeight: 80 }}>
      <button
        type="button"
        onClick={() => onOpen?.(allAttachments, index)}
        className={["relative block w-full overflow-hidden hover:opacity-90 transition-opacity bg-black/10", rounded].join(" ")}
        style={{ aspectRatio: String(boxRatio) }}
      >
        {isLoading ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin opacity-40" />
          </div>
        ) : url && failedUrl !== url ? (
          <img
            src={url}
            alt={att.fileName}
            className="block w-full h-full object-cover"
            onLoad={(e) => {
              const w = e.currentTarget.naturalWidth;
              const h = e.currentTarget.naturalHeight;
              if (w > 0 && h > 0) {
                setRatio(Math.min(THUMB_MAX_RATIO, Math.max(THUMB_MIN_RATIO, w / h)));
              }
            }}
            onError={() => {
              console.warn("[chat] image load failed", { url, id: att.id });
              setFailedUrl(url);
            }}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center opacity-40">
            <FileText className="h-6 w-6" />
          </div>
        )}
      </button>
      <AttachmentTileActions
        att={att}
        messageId={messageId}
        isOwn={isOwn}
        onToggleReaction={onToggleReaction}
        onDeleteAttachment={onDeleteAttachment}
        deleting={deletingAttachmentId === att.id}
      />
      <AttachmentReactionPills
        reactions={att.reactions}
        currentUserId={currentUserId}
        onToggleReaction={onToggleReaction}
        messageId={messageId}
        attachmentId={att.id}
      />
    </div>
  );
}

// ── Video card ────────────────────────────────────────────────────────────────
function VideoCard({ att, index, allAttachments, onOpen, messageId, isOwn, currentUserId, onToggleReaction, onDeleteAttachment, deletingAttachmentId, merged = false }) {
  const { data: url, isLoading } = useAttachmentUrl(att);
  const [videoErr, setVideoErr] = useState(false);

  // Appending #t=0.001 forces the browser to seek 1ms in and paint that frame as a thumbnail
  const videoSrc = url ? `${url}#t=0.001` : null;

  return (
    <div
      data-attachment-id={att.id}
      className={["relative group block overflow-hidden bg-black/25", merged ? "" : "rounded-xl mt-1.5"].join(" ")}
      style={{ width: merged ? "100%" : 220, height: merged ? 200 : 140, maxWidth: "100%" }}
    >
      <button
        type="button"
        onClick={() => onOpen?.(allAttachments, index)}
        className="absolute inset-0 w-full h-full hover:opacity-90 active:opacity-70 transition-opacity"
      >
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-white/50" />
          </div>
        )}

        {videoSrc && !videoErr ? (
          <video
            src={videoSrc}
            className="absolute inset-0 w-full h-full object-cover"
            muted
            playsInline
            preload="auto"
            onError={() => setVideoErr(true)}
          />
        ) : !isLoading ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <FileVideo className="h-10 w-10 text-white/40" />
          </div>
        ) : null}

        {/* Play overlay — always visible */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="h-12 w-12 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center shadow-lg">
            <Play className="h-6 w-6 text-white fill-white ml-0.5" />
          </div>
        </div>

        {/* Filename label at bottom */}
        {att.fileName && (
          <div className="absolute bottom-0 left-0 right-0 px-2 py-1 bg-linear-to-t from-black/60 to-transparent">
            <p className="text-[10px] text-white/80 truncate">{att.fileName}</p>
          </div>
        )}
      </button>
      <AttachmentTileActions
        att={att}
        messageId={messageId}
        isOwn={isOwn}
        onToggleReaction={onToggleReaction}
        onDeleteAttachment={onDeleteAttachment}
        deleting={deletingAttachmentId === att.id}
      />
      <AttachmentReactionPills
        reactions={att.reactions}
        currentUserId={currentUserId}
        onToggleReaction={onToggleReaction}
        messageId={messageId}
        attachmentId={att.id}
      />
    </div>
  );
}

// ── Audio card (voice message player) ────────────────────────────────────────
function fmtAudioTime(secs) {
  if (!isFinite(secs) || secs < 0) return "0:00";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Seeded LCG so the waveform is deterministic per attachment (same each render)
function seedBars(seed, count) {
  let s = seed;
  return Array.from({ length: count }, () => {
    s = (s * 1664525 + 1013904223) | 0;
    return 24 + (Math.abs(s) % 76); // 24-100% height
  });
}

// Minimal WhatsApp-style voice player: one play/pause control, a seekable
// waveform, and a SINGLE time readout — elapsed while it plays/after a scrub,
// total length when idle. Deliberately no playback-speed pill and no second
// timer (the old card stacked "0:00" + "—:——" + "x1", which read as three
// competing counters).
export function AudioCard({ att, isOwn }) {
  const { data: url, isLoading, refetch, isFetching } = useAttachmentUrl(att);
  const audioRef = useRef(null);
  // A media error is most often a stale signed URL — refetch + reload once
  // before showing the "no disponible" state.
  const retriedRef = useRef(false);
  const decodeTriedRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [elementDuration, setElementDuration] = useState(0);
  const [decodedDuration, setDecodedDuration] = useState(0);
  const [started, setStarted] = useState(false); // has playback ever advanced?
  const [loadError, setLoadError] = useState(false);

  // Duration priority: server value (measured client-side at record time) >
  // whatever the media element resolves > a one-shot decodeAudioData of the
  // blob. No seek hacks — `audio.currentTime = 1e101` wedged playback on
  // mobile Safari (showed "0:0", then only a corrupted fraction played).
  const serverDuration =
    Number.isFinite(att?.durationMs) && att.durationMs > 0 ? att.durationMs / 1000 : 0;
  const duration = serverDuration || elementDuration || decodedDuration || 0;

  const bars = useMemo(() => {
    const seed = Array.from(String(att.id)).reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) | 0, 0);
    return seedBars(seed, 30);
  }, [att.id]);

  // Legacy notes (uploaded before duration_ms) and any blob the element can't
  // measure: decode the downloaded audio once to get an exact length.
  async function decodeDurationFallback() {
    if (decodeTriedRef.current || serverDuration || elementDuration || !url) return;
    decodeTriedRef.current = true;
    try {
      const res = await fetch(url);
      const buf = await res.arrayBuffer();
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      const decoded = await ctx.decodeAudioData(buf.slice(0));
      if (isFinite(decoded?.duration) && decoded.duration > 0) setDecodedDuration(decoded.duration);
      ctx.close?.();
    } catch {
      // Leave the length unknown ("--:--"); linear playback still works.
    }
  }

  function togglePlay() {
    const audio = audioRef.current;
    if (loadError || !url || !isSignedUrlUsable(url)) {
      setLoadError(false);
      refetch().then(() => audioRef.current?.load());
      return;
    }
    if (!audio) return;
    if (playing) audio.pause();
    else audio.play().catch(() => setLoadError(true));
  }

  function handleSeek(e) {
    const audio = audioRef.current;
    if (!audio || !duration) return; // seek stays disabled until a length is known
    const rect = e.currentTarget.getBoundingClientRect();
    const clientX = e.changedTouches?.[0]?.clientX ?? e.touches?.[0]?.clientX ?? e.clientX;
    if (!isFinite(clientX)) return;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    audio.currentTime = ratio * duration;
    setCurrentTime(ratio * duration);
    setStarted(true);
  }

  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;
  const timeLabel = duration > 0
    ? fmtAudioTime(started ? currentTime : duration)
    : started
      ? fmtAudioTime(currentTime)
      : "--:--";

  const playBg    = isOwn ? "rgba(255,255,255,0.22)" : "var(--brand-primary)";
  const playColor = isOwn ? "white"                  : "var(--brand-primary-foreground)";
  const barPlayed = isOwn ? "rgba(255,255,255,0.95)" : "var(--brand-primary)";
  // `hsl(var(--border))` is near-invisible on a light received bubble — use a
  // muted-foreground tint so the idle waveform reads in both themes. 0.4 was
  // still too faint against the light theme's near-white muted bubble bg.
  const barRest   = isOwn ? "rgba(255,255,255,0.30)" : "hsl(var(--muted-foreground) / 0.55)";
  const metaColor = isOwn ? "rgba(255,255,255,0.70)" : "hsl(var(--muted-foreground))";

  // Keep the player visible and retryable even when URL resolution fails.
  const unavailable = loadError || (!isLoading && !url);
  const playDisabled = isLoading || isFetching;

  return (
    <div className="mt-2 flex items-center gap-2.5" style={{ width: "100%", minWidth: 200, maxWidth: 340 }}>
      {url && (
        <audio
          ref={audioRef}
          src={url}
          preload="metadata"
          onLoadStart={() => {
            setPlaying(false);
            setCurrentTime(0);
            setStarted(false);
          }}
          onLoadedMetadata={(e) => {
            setLoadError(false);
            retriedRef.current = false;
            const d = e.currentTarget.duration;
            if (isFinite(d) && d > 0) setElementDuration(d);
            else decodeDurationFallback();
          }}
          onDurationChange={(e) => {
            const d = e.currentTarget.duration;
            if (isFinite(d) && d > 0) setElementDuration(d);
          }}
          onTimeUpdate={(e) => {
            const t = e.currentTarget.currentTime;
            if (!isFinite(t)) return;
            // Some recorded voice-note blobs (notably iOS Safari's audio/mp4
            // MediaRecorder output) carry a broken/absent container duration,
            // so the element never reaches a real end-of-stream and `ended`
            // never fires — playback just continues past the real audio in
            // silence forever. serverDuration is measured wall-clock at
            // record time and is always correct, so once playback reaches it
            // treat that as the end instead of waiting on the native event.
            if (serverDuration > 0 && t >= serverDuration - 0.15) {
              const audio = e.currentTarget;
              audio.pause();
              audio.currentTime = 0;
              setPlaying(false);
              setStarted(false);
              setCurrentTime(0);
              return;
            }
            setCurrentTime(t);
            if (t > 0) setStarted(true);
          }}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setStarted(false);
            setCurrentTime(0);
            if (audioRef.current) audioRef.current.currentTime = 0;
          }}
          onError={(e) => {
            console.warn("[chat] audio load failed", {
              id: att.id, mimeType: att.mimeType,
              code: e.currentTarget?.error?.code, message: e.currentTarget?.error?.message,
            });
            if (!retriedRef.current) {
              retriedRef.current = true;
              refetch().then(() => audioRef.current?.load()).catch(() => setLoadError(true));
              return;
            }
            setLoadError(true);
          }}
        />
      )}

      {/* Play / pause */}
      <button
        type="button"
        onClick={togglePlay}
        disabled={playDisabled}
        className="shrink-0 h-10 w-10 rounded-full flex items-center justify-center touch-manipulation active:scale-95 transition-transform disabled:opacity-70 disabled:active:scale-100"
        style={{ backgroundColor: playBg, color: playColor }}
        aria-label={isLoading ? "Cargando..." : loadError || !url ? "Reintentar audio" : playing ? "Pausar" : "Reproducir"}
      >
        {isLoading
          ? <Loader2 className="h-4 w-4 animate-spin" />
          : unavailable
          ? <AlertCircle className="h-4 w-4" />
          : playing
          ? <Pause className="h-4.5 w-4.5 fill-current" />
          : <Play  className="h-4.5 w-4.5 fill-current ml-0.5" />}
      </button>

      {/* Waveform + single time readout (or an error line, in place) */}
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <div
          className="flex items-center gap-px cursor-pointer touch-manipulation select-none"
          style={{ height: 26, opacity: loadError ? 0.35 : 1 }}
          onClick={loadError ? undefined : handleSeek}
          onTouchEnd={loadError ? undefined : handleSeek}
        >
          {bars.map((h, i) => (
            <div
              key={i}
              style={{
                flexShrink: 0,
                width: 2.5,
                height: `${h}%`,
                borderRadius: 2,
                backgroundColor: !loadError && (i + 0.5) / bars.length <= progress ? barPlayed : barRest,
                transition: "background-color 0.08s linear",
              }}
            />
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          {unavailable ? (
            <>
              <span className="text-[10px] leading-none" style={{ color: metaColor }}>
                Audio no disponible. Toca para reintentar
              </span>
              {url && <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] leading-none underline underline-offset-2 shrink-0"
                style={{ color: metaColor }}
              >
                Abrir archivo
              </a>}
            </>
          ) : (
            <>
              <Mic className="h-2.5 w-2.5 shrink-0" style={{ color: metaColor }} />
              <span className="text-[10px] leading-none tabular-nums" style={{ color: metaColor }}>
                {timeLabel}
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── File card (generic) ───────────────────────────────────────────────────────
function FileCard({ att, index, allAttachments, onOpen, isOwn, office }) {
  const { data: url } = useAttachmentUrl(att);
  const { Icon, colorClass } = getFileTypeInfo(att.mimeType);

  function handleDownload(e) {
    e?.stopPropagation?.();
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = att.fileName ?? "archivo";
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.click();
  }

  const menuItems = buildAttachmentActions({ att, url, office });

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          data-attachment-id={att.id}
          className={[
            "flex items-center gap-2.5 mt-1.5 px-3 py-2 rounded-xl max-w-55",
            isOwn ? "bg-white/15" : "bg-[hsl(var(--border))]",
          ].join(" ")}
        >
          <button
            type="button"
            onClick={() => onOpen?.(allAttachments, index)}
            className="flex items-center gap-2.5 min-w-0 flex-1 text-left"
          >
            <Icon className={`h-4 w-4 shrink-0 ${colorClass}`} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">{att.fileName}</p>
              <p className="text-xs opacity-50">{formatFileSize(att.sizeBytes)}</p>
            </div>
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={!url}
            title="Descargar"
            className="shrink-0 opacity-60 hover:opacity-100 transition-opacity disabled:opacity-20"
          >
            <Download className="h-4 w-4" />
          </button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        {menuItems.map((a) => (
          <ContextMenuItem key={a.key} disabled={a.disabled} onSelect={() => a.onSelect()}>
            {a.icon && <a.icon className="h-4 w-4 mr-2" />}
            {a.label}
          </ContextMenuItem>
        ))}
        <ContextMenuSeparator />
        <ContextMenuItem disabled={!url} onSelect={() => handleDownload()}>
          <Download className="h-4 w-4 mr-2" />
          Descargar
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

// ── Cover cell for image grids ────────────────────────────────────────────────
function ImageCoverCell({ att, index, allAttachments, onOpen, overflowCount = 0, messageId, isOwn, currentUserId, onToggleReaction, onDeleteAttachment, deletingAttachmentId }) {
  const { data: url, isLoading } = useAttachmentUrl(att);
  const [failedUrl, setFailedUrl] = useState(null);

  return (
    <div data-attachment-id={att.id} className="absolute inset-0 w-full h-full group">
      <button
        type="button"
        onClick={() => onOpen?.(allAttachments, index)}
        className="block w-full h-full hover:opacity-90 transition-opacity bg-black/10"
      >
        {isLoading ? (
          <div className="flex items-center justify-center w-full h-full">
            <Loader2 className="h-4 w-4 animate-spin opacity-40" />
          </div>
        ) : url && failedUrl !== url ? (
          <img
            src={url}
            alt={att.fileName}
            className="w-full h-full object-cover"
            onError={() => {
              console.warn("[chat] image load failed", { url, id: att.id });
              setFailedUrl(url);
            }}
          />
        ) : (
          <div className="flex items-center justify-center w-full h-full opacity-40">
            <FileImage className="h-5 w-5" />
          </div>
        )}
        {overflowCount > 0 && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/60 text-white font-bold text-xl pointer-events-none">
            +{overflowCount}
          </span>
        )}
      </button>
      {overflowCount === 0 && (
        <>
          <AttachmentTileActions
            att={att}
            messageId={messageId}
            isOwn={isOwn}
            onToggleReaction={onToggleReaction}
            onDeleteAttachment={onDeleteAttachment}
            deleting={deletingAttachmentId === att.id}
          />
          <AttachmentReactionPills
            reactions={att.reactions}
            currentUserId={currentUserId}
            onToggleReaction={onToggleReaction}
            messageId={messageId}
            attachmentId={att.id}
          />
        </>
      )}
    </div>
  );
}

// ── Image grid (Telegram-style layouts) ───────────────────────────────────────
function ImageGrid({ images, allAttachments, onOpen, startIndex, messageId, isOwn, currentUserId, onToggleReaction, onDeleteAttachment, deletingAttachmentId, merged = false }) {
  const shown = images.slice(0, 4);
  const overflowCount = Math.max(0, images.length - 4);
  const count = shown.length;
  // Per-tile action/reaction props are identical for every cell — bundle
  // them once and spread, rather than repeating six props across five call
  // sites.
  const tileProps = { messageId, isOwn, currentUserId, onToggleReaction, onDeleteAttachment, deletingAttachmentId };

  // `merged`: the grid sits flush inside a caption bubble — fill its width, no
  // top margin, no outer rounding (the bubble clips).
  const mt = merged ? "" : "mt-1.5";
  const rounded = merged ? "" : "rounded-xl";
  const gridWidth = merged ? "100%" : 220;

  // 1 image: bounded, more-square preview box (ImageCard clamps its ratio)
  if (count === 1) {
    return (
      <div className={mt} style={{ width: merged ? "100%" : 220, maxWidth: "100%" }}>
        <ImageCard att={images[0]} index={startIndex} allAttachments={allAttachments} onOpen={onOpen} merged={merged} {...tileProps} />
      </div>
    );
  }

  // 2 images: side-by-side square cells
  if (count === 2) {
    return (
      <div className={[mt, "flex gap-0.5 overflow-hidden", rounded].join(" ")} style={{ width: gridWidth, maxWidth: '100%' }}>
        {shown.map((att, i) => (
          <div key={att.id} className="relative flex-1" style={{ height: 110 }}>
            <ImageCoverCell att={att} index={startIndex + i} allAttachments={allAttachments} onOpen={onOpen} {...tileProps} />
          </div>
        ))}
      </div>
    );
  }

  // 3 images: 1 wide on top + 2 side-by-side below
  if (count === 3) {
    return (
      <div className={[mt, "overflow-hidden", rounded].join(" ")} style={{ width: gridWidth, maxWidth: '100%' }}>
        <div className="relative" style={{ height: 132 }}>
          <ImageCoverCell att={shown[0]} index={startIndex} allAttachments={allAttachments} onOpen={onOpen} {...tileProps} />
        </div>
        <div className="flex gap-0.5 mt-0.5">
          {shown.slice(1).map((att, i) => (
            <div key={att.id} className="relative flex-1" style={{ height: 86 }}>
              <ImageCoverCell att={att} index={startIndex + 1 + i} allAttachments={allAttachments} onOpen={onOpen} {...tileProps} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // 4+ images: 2×2 grid, last cell shows overflow counter
  return (
    <div className={[mt, "overflow-hidden", rounded].join(" ")} style={{ width: gridWidth, maxWidth: '100%' }}>
      <div className="flex gap-0.5">
        {shown.slice(0, 2).map((att, i) => (
          <div key={att.id} className="relative flex-1" style={{ height: 110 }}>
            <ImageCoverCell att={att} index={startIndex + i} allAttachments={allAttachments} onOpen={onOpen} {...tileProps} />
          </div>
        ))}
      </div>
      <div className="flex gap-0.5 mt-0.5">
        {shown.slice(2, 4).map((att, i) => (
          <div key={att.id} className="relative flex-1" style={{ height: 110 }}>
            <ImageCoverCell
              att={att}
              index={startIndex + 2 + i}
              allAttachments={allAttachments}
              onOpen={onOpen}
              overflowCount={i === 1 ? overflowCount : 0}
              {...tileProps}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Attachments renderer ──────────────────────────────────────────────────────
export function AttachmentsBlock({ attachments, onOpen, isOwn, messageId, currentUserId, onToggleReaction, onDeleteAttachment, deletingAttachmentId, merged = false }) {
  const office = useOfficeActions();
  if (!attachments?.length) return null;

  // Group images together for grid layout
  const imageAtts = attachments.filter((a) => isImageMime(a.mimeType));
  const others = attachments.filter((a) => !isImageMime(a.mimeType));

  // Reorder: images first (for viewer indexing), then others
  const ordered = [...imageAtts, ...others];

  // Same six per-tile props for the grid and every video card.
  const tileProps = { messageId, isOwn, currentUserId, onToggleReaction, onDeleteAttachment, deletingAttachmentId };

  // `merged` (caller = MediaCaptionBubble) guarantees all-images or one video;
  // render just that media flush inside the caption bubble, no top margin, no
  // own rounding — the bubble's overflow-hidden clips it.
  if (merged) {
    if (imageAtts.length > 0) {
      return <ImageGrid images={imageAtts} allAttachments={ordered} onOpen={onOpen} startIndex={0} merged {...tileProps} />;
    }
    return <VideoCard att={others[0]} index={0} allAttachments={ordered} onOpen={onOpen} merged {...tileProps} />;
  }

  return (
    <>
      {imageAtts.length > 0 && (
        <ImageGrid
          images={imageAtts}
          allAttachments={ordered}
          onOpen={onOpen}
          startIndex={0}
          {...tileProps}
        />
      )}
      {others.map((att, i) => {
        const globalIdx = imageAtts.length + i;
        // Audio is checked BEFORE video: a voice note whose mime got dropped
        // or remapped to video/webm on upload (seen on some mobile browsers)
        // must still render as the audio player, not a black video tile.
        if (isAudioAttachment(att)) {
          return <AudioCard key={att.id} att={att} isOwn={isOwn} />;
        }
        if (isVideoMime(att.mimeType)) {
          return (
            <VideoCard
              key={att.id}
              att={att}
              index={globalIdx}
              allAttachments={ordered}
              onOpen={onOpen}
              {...tileProps}
            />
          );
        }
        return (
          <FileCard
            key={att.id}
            att={att}
            index={globalIdx}
            allAttachments={ordered}
            onOpen={onOpen}
            isOwn={isOwn}
            office={office}
          />
        );
      })}
    </>
  );
}
