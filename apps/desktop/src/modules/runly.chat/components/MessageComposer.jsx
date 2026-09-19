import {
  useState,
  useRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  forwardRef,
} from "react";
import {
  Button, MentionTextarea, Popover, PopoverAnchor, PopoverContent,
  Dialog, DialogContent, DialogHeader, DialogTitle, useCoarsePointer,
} from "@runly/ui";
import {
  Send, Paperclip, Smile, X, Loader2, AlertCircle, Mic, Plus,
  Play, FileText, FileType2, FileSpreadsheet, FileImage, FileVideo, FileAudio,
  FileArchive, FileCode, File as FileIcon, Link2, User, Landmark, IdCard,
} from "lucide-react";
import { toast } from "sonner";
import { ThemedEmojiPicker } from "./ThemedEmojiPicker";
import { useChatUpload } from "../hooks/useChatUpload";
import { useMentionCandidates } from "../hooks/useMentionCandidates";
import { MIRAI_MENTION_ID } from "../lib/mirai";
import { formatFileSize } from "../lib/chatUtils";
import { useAuth } from "../../../auth/AuthProvider";
import { EntityReferencePicker } from "./EntityReferencePicker";
import { DropZoneOverlay } from "./DropZoneOverlay";
import { MessageQuote } from "./MessageQuote";
import { ChatAttachmentViewer } from "./ChatAttachmentViewer";
import { mapPendingToViewerFiles, attachmentIdsToDiscard } from "../lib/pendingAttachments";

// Quick-access emoji for the mobile inline strip (matches MessageReactionPicker).
const QUICK_EMOJIS = ["👍", "❤️", "😂", "🙏", "🔥", "😮", "😢", "🎉"];

// A replyingTo value may be a full message object (from a bubble) or an
// already-shaped preview. Normalise to the API preview shape MessageQuote wants.
function toReplyPreview(m) {
  if (!m) return null;
  if (m.kind && "senderName" in m) return m; // already a preview
  const att = (m.attachments ?? [])[0];
  const hasRefs = Array.isArray(m.metadata?.entityRefs) && m.metadata.entityRefs.length > 0;
  const body = (m.body ?? "").trim();
  const attMime = String(att?.mimeType ?? "");
  // Voice notes recorded in-app are named "nota_de_voz_*"; some mobile
  // browsers drop or remap the blob mime on upload, so match the name too.
  const attIsAudio = attMime.startsWith("audio/") || /^nota_de_voz/i.test(String(att?.fileName ?? ""));
  let kind = "text";
  if (!body && attMime.startsWith("image/")) kind = "image";
  else if (!body && attIsAudio) kind = "audio";
  else if (!body && attMime.startsWith("video/")) kind = "video";
  else if (!body && att) kind = "file";
  else if (!body && hasRefs) kind = "entity";
  return {
    id: m.id,
    senderUserId: m.sender_user_id ?? m.sender?.id ?? null,
    senderName: m.sender?.displayName ?? "Usuario",
    bodyPreview: body ? (body.length > 120 ? body.slice(0, 120) : body) : null,
    kind,
    isDeleted: Boolean(m.deleted_at),
  };
}

// Maps a stored/pending entityType string to its chip/card icon — same 4-way
// mapping used by EntityReferenceCard.jsx for the resolved cards.
const ENTITY_REF_ICON = {
  contact: User,
  file: Paperclip,
  ledger_account: Landmark,
  hr_employee: IdCard,
};

const MAX_ENTITY_REFS = 5;

// Preferred audio MIME type for recording. audio/mp4 (AAC) comes first because
// it is the only format every recipient's <audio> element can actually play
// back — Safari (iOS and macOS) cannot decode WebM/Opus at all, so a voice
// note recorded as webm;codecs=opus (the old default on Chrome/Android/
// desktop) played fine for the sender but silently failed to play for any
// Safari listener. Chrome/Edge also support recording audio/mp4, so most
// senders now land on the universally-compatible format; only Firefox (which
// has no MediaRecorder mp4 encoder) falls through to webm/ogg.
function getRecordingMime() {
  if (typeof MediaRecorder === "undefined") return null;
  const candidates = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/ogg"];
  return candidates.find((m) => {
    try { return MediaRecorder.isTypeSupported(m); }
    catch { return false; }
  }) ?? "audio/mp4"; // audio/mp4 is the iOS fallback (Safari 14.3+)
}

function mimeToExt(mimeType) {
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("mp4")) return "m4a";
  return "webm";
}

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

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

function AttachmentPreviewCard({ entry, onRemove, onOpen, onRetry }) {
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

export const MessageComposer = forwardRef(function MessageComposer(
  {
    onSend,
    onTyping,
    disabled,
    placeholder = "Escribe un mensaje...",
    compact = false,
    conversationId,
    conversationType,
    replyingTo = null,
    onCancelReply,
    // Set by callers (ChatWindow, MiniChatWindow) that already wrap this
    // composer in their own outer drag-and-drop zone covering the whole
    // message area. Without this, dropping a file directly on the composer
    // fired BOTH zones' handlers (the drop event bubbles up to the outer
    // one), double-queuing every dropped file — and since the outer zone
    // never saw its own dragover/dragleave pair once events stopped
    // propagating past the composer, its overlay got stuck visible. Standalone
    // callers (ThreadPanel, ExternalInboxScreen) have no outer zone, so they
    // leave this false and keep the composer's own handling.
    dropZoneDisabled = false,
    // True only for the ONE caller that owns the screen's bottom edge in a
    // given context (ChatWindow's main composer, ThreadPanel's sheet
    // composer). Those add a single iOS home-indicator gap here. Floating /
    // mini windows and any nested reuse leave this false so the inset is
    // never stacked twice (the bug that pushed the input bar upward).
    edgeInset = false,
  },
  ref,
) {
  const [body, setBody] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [emojiModalOpen, setEmojiModalOpen] = useState(false);
  // Touch devices get an in-flow quick strip + a full-screen-safe Dialog
  // instead of the desktop Popover, which Radix could flip off-screen when
  // the composer sits at the bottom of a Sheet.
  const coarse = useCoarsePointer();
  const [isDragOver, setIsDragOver] = useState(false);
  const [pendingFiles, setPendingFiles] = useState([]);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [recordingError, setRecordingError] = useState(null);
  const [pendingEntityRefs, setPendingEntityRefs] = useState([]);
  const [showEntityPicker, setShowEntityPicker] = useState(false);
  const [attView, setAttView] = useState({ open: false, index: 0 });

  // spec Non-goal 3: entity references must never be offered in
  // external_support conversations — composer-level enforcement only, the
  // real safety net is Plan A's backend Zod validation + resolver.
  const canAttachEntityRefs = Boolean(conversationType) && conversationType !== "external_support";

  const { userProfile } = useAuth();
  const currentUserId = userProfile?.id;
  const mentionCandidates = useMentionCandidates(conversationId, currentUserId);
  // @-mentions of people only make sense where there's a group to address — in
  // a 1:1 there's nobody else to pick from. But @MirAI is still useful in a
  // DM (ask the assistant a question you both see), so keep just that one.
  const mentionMembers =
    conversationType === "direct"
      ? mentionCandidates.filter((m) => m.id === MIRAI_MENTION_ID)
      : mentionCandidates;

  const fileInputRef = useRef(null);
  const typingTimeout = useRef(null);
  const isTypingRef = useRef(false);
  const uploadingRef = useRef({});
  const objectUrlsRef = useRef(new Set());
  const recorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recordTimerRef = useRef(null);
  const recordMimeRef = useRef(null);
  const recordStartedAtRef = useRef(0);
  const stopWatchdogRef = useRef(null);
  const voiceAutoSendRef = useRef(false);
  const handleSendRef = useRef(null);
  const mentionTaRef = useRef(null);
  const wasSendingRef = useRef(false);
  // Per-conversation draft cache — this composer instance is reused as the
  // user switches conversations (ChatWindow doesn't remount it), so without
  // this the last-typed, unsent text leaked into whichever chat was opened
  // next. Kept in a plain in-memory ref (not localStorage): each chat gets
  // its draft back when reopened within this session, but nothing survives
  // a reload or leaks across conversations.
  const draftsRef = useRef(new Map());
  const prevConversationIdRef = useRef(conversationId);
  // localIds handed to a SUCCESSFUL send — the cleanup paths must not discard
  // the server rows those became.
  const sentLocalIdsRef = useRef(new Set());
  // Latest pendingFiles, readable from unmount/switch cleanup closures.
  const pendingFilesRef = useRef([]);

  const { uploadFile, deleteUpload } = useChatUpload(conversationId);

  useImperativeHandle(ref, () => ({
    addFiles: (files) => addFilesToQueue(files),
    setBody: (text) => setBody(text),
    // Fill the composer with a suggested prompt (only if empty) and focus it,
    // so the user can edit or send. Used by the MirAI intro chips.
    prefill: (text) => {
      setBody((prev) => (prev?.trim() ? prev : String(text ?? "")));
      requestAnimationFrame(() => mentionTaRef.current?.focus?.());
    },
  }));

  // Runs on every render where conversationId just changed, while `body`
  // still holds whatever was left typed in the PREVIOUS conversation (state
  // updates from this same effect haven't committed yet) — stash it as that
  // conversation's draft, then swap in the new conversation's own draft (or
  // blank, if it has none).
  useEffect(() => {
    const prevId = prevConversationIdRef.current;
    if (prevId === conversationId) return;
    // Leaving this conversation with queued-but-unsent uploads: discard them
    // server-side and drop them from the composer (they were presigned against
    // the OLD conversation — they must not ride along into the new one).
    for (const id of attachmentIdsToDiscard(pendingFilesRef.current, sentLocalIdsRef.current)) {
      deleteUpload(id).catch(() => {});
    }
    if (pendingFilesRef.current.length) {
      for (const entry of pendingFilesRef.current) {
        if (entry.objectUrl) {
          URL.revokeObjectURL(entry.objectUrl);
          objectUrlsRef.current.delete(entry.objectUrl);
        }
        delete uploadingRef.current[entry.localId];
      }
      setPendingFiles([]);
    }
    sentLocalIdsRef.current = new Set();
    if (prevId != null) {
      if (body.trim()) draftsRef.current.set(prevId, body);
      else draftsRef.current.delete(prevId);
    }
    setBody(conversationId != null ? (draftsRef.current.get(conversationId) ?? "") : "");
    prevConversationIdRef.current = conversationId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  function addFilesToQueue(files) {
    const entries = Array.from(files).map((file) => {
      // Every pending file gets a blob URL now, not just image/video: it lets
      // the composer's viewer render PDFs/text/Office locally and instantly,
      // and it rides the same revoke paths (removeFile / send / unmount).
      const objectUrl = URL.createObjectURL(file);
      objectUrlsRef.current.add(objectUrl);
      return {
        localId: `${Date.now()}-${Math.random()}`,
        file,
        objectUrl,
        uploading: Boolean(conversationId),
        done: !conversationId,
        error: null,
        attachmentId: null,
      };
    });
    setPendingFiles((prev) => [...prev, ...entries]);
    if (conversationId) {
      for (const entry of entries) startUpload(entry);
    }
  }

  function startUpload(entry) {
    setPendingFiles((prev) =>
      prev.map((f) => (f.localId === entry.localId ? { ...f, uploading: true, error: null } : f)),
    );
    const promise = uploadFile(entry.file)
      .then((attachmentId) => {
        setPendingFiles((prev) =>
          prev.map((f) =>
            f.localId === entry.localId ? { ...f, uploading: false, done: true, attachmentId } : f,
          ),
        );
        return attachmentId;
      })
      .catch((err) => {
        setPendingFiles((prev) =>
          prev.map((f) =>
            f.localId === entry.localId
              ? { ...f, uploading: false, error: err?.message ?? "Error al subir" }
              : f,
          ),
        );
        return null;
      });
    uploadingRef.current[entry.localId] = promise;
  }

  useEffect(() => {
    pendingFilesRef.current = pendingFiles;
  }, [pendingFiles]);

  useEffect(() => {
    return () => {
      for (const objectUrl of objectUrlsRef.current) URL.revokeObjectURL(objectUrl);
      objectUrlsRef.current.clear();
      // Uploads that finished but were never sent (composer closed with files
      // still queued) — discard their server rows + objects.
      for (const id of attachmentIdsToDiscard(pendingFilesRef.current, sentLocalIdsRef.current)) {
        deleteUpload(id).catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Voice recording ──────────────────────────────────────────────────────
  async function startRecording() {
    setRecordingError(null);
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setRecordingError("Grabacion de audio no disponible en este dispositivo.");
      return;
    }
    const mimeType = getRecordingMime();
    if (!mimeType) {
      setRecordingError("Formato de audio no soportado en este dispositivo.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType });
      audioChunksRef.current = [];
      recordMimeRef.current = mimeType;
      recordStartedAtRef.current = 0;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = () => finalizeRecording(stream);

      // No timeslice: some mobile browsers (iOS Safari) emit corrupt fragments
      // when MediaRecorder is chunked — one valid container on stop plays back
      // cleanly.
      recordStartedAtRef.current = performance.now();
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
      setRecordSeconds(0);
      recordTimerRef.current = setInterval(() => {
        setRecordSeconds((s) => s + 1);
      }, 1000);
    } catch (err) {
      const msg = err?.name === "NotAllowedError" || err?.name === "PermissionDeniedError"
        ? "Permiso de microfono denegado."
        : "No se pudo iniciar la grabacion.";
      setRecordingError(msg);
    }
  }

  // Shared by the normal recorder.onstop path and the watchdog fallback below
  // (both end up with the same chunks/mimeType/startedAt in refs).
  function finalizeRecording(stream) {
    stream?.getTracks().forEach((t) => t.stop());
    clearInterval(recordTimerRef.current);
    const mimeType = recordMimeRef.current;
    const ext = mimeToExt(mimeType);
    const baseMime = mimeType.split(";")[0];
    const blob = new Blob(audioChunksRef.current, { type: baseMime });
    const now = new Date();
    const ts = `${now.getHours().toString().padStart(2,"0")}-${now.getMinutes().toString().padStart(2,"0")}-${now.getSeconds().toString().padStart(2,"0")}`;
    const file = new File([blob], `nota_de_voz_${ts}.${ext}`, { type: baseMime });
    // Real length, wall-clock — the only reliable source (webm/opus blobs
    // report no duration). Rides along on the File to presign as durationMs.
    const startedAt = recordStartedAtRef.current;
    const durationMs = startedAt ? Math.max(0, Math.round(performance.now() - startedAt)) : null;
    if (durationMs != null) {
      try { file.voiceDurationMs = durationMs; } catch { /* File expando unsupported */ }
    }
    setRecording(false);
    setRecordSeconds(0);
    voiceAutoSendRef.current = true;
    addFilesToQueue([file]);
  }

  function stopRecording(discard = false) {
    clearInterval(recordTimerRef.current);
    clearTimeout(stopWatchdogRef.current);
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (discard) {
      recorder.ondataavailable = null;
      recorder.onstop = () => {
        recorderRef.current?.stream?.getTracks().forEach((t) => t.stop());
        setRecording(false);
        setRecordSeconds(0);
      };
    }
    // iOS Safari's MediaRecorder has a known bug where stop() can silently
    // never fire `onstop` (and never releases the mic) unless a pending
    // internal buffer is flushed first — requestData() forces that flush.
    try { if (recorder.state === "recording") recorder.requestData(); } catch { /* unsupported */ }
    recorder.stop();
    // Watchdog: if `onstop` still never arrives, the UI was previously stuck
    // showing "recording" indefinitely — the mic only actually released (with
    // its stop chime) when the OS backgrounded the app and force-killed the
    // stream. Force the same cleanup onstop would have done after a short
    // grace period instead of waiting on a browser event that may never come.
    stopWatchdogRef.current = setTimeout(() => {
      if (recorderRef.current !== recorder || recorder.state === "inactive") return;
      recorder.ondataavailable = null;
      recorder.onstop = null;
      if (discard) {
        recorder.stream?.getTracks().forEach((t) => t.stop());
        setRecording(false);
        setRecordSeconds(0);
      } else {
        finalizeRecording(recorder.stream);
      }
    }, 1500);
  }

  useEffect(() => {
    return () => {
      clearInterval(recordTimerRef.current);
      clearTimeout(stopWatchdogRef.current);
      if (recorderRef.current?.state !== "inactive") {
        recorderRef.current?.stream?.getTracks().forEach((t) => t.stop());
        recorderRef.current?.stop();
      }
    };
  }, []);

  // ── File queue ───────────────────────────────────────────────────────────
  function openPendingViewer(entry) {
    const viewerFiles = mapPendingToViewerFiles(pendingFiles);
    const index = viewerFiles.findIndex((f) => f.id === entry.localId);
    if (index < 0) return; // audio card — no viewer
    setAttView({ open: true, index });
  }

  function removeFile(localId) {
    const entry = pendingFiles.find((file) => file.localId === localId);
    if (entry?.objectUrl) {
      URL.revokeObjectURL(entry.objectUrl);
      objectUrlsRef.current.delete(entry.objectUrl);
    }
    // Discard the server-side upload too. If it already finished we have the
    // id; if it's still in flight, wait for the id then delete. Fire-and-forget
    // so the card disappears immediately; the worker sweep is the backstop.
    if (entry?.attachmentId) {
      deleteUpload(entry.attachmentId).catch(() => {});
    } else if (uploadingRef.current[localId]) {
      Promise.resolve(uploadingRef.current[localId])
        .then((id) => id && deleteUpload(id))
        .catch(() => {});
    }
    setPendingFiles((prev) => prev.filter((file) => file.localId !== localId));
    delete uploadingRef.current[localId];
  }

  // ── Entity references ────────────────────────────────────────────────────
  function addEntityRef(ref) {
    setPendingEntityRefs((prev) => {
      if (prev.length >= MAX_ENTITY_REFS) return prev;
      if (prev.some((r) => r.entityType === ref.entityType && r.recordId === ref.recordId)) return prev;
      return [...prev, ref];
    });
  }

  function removeEntityRef(entityType, recordId) {
    setPendingEntityRefs((prev) =>
      prev.filter((r) => !(r.entityType === entityType && r.recordId === recordId)),
    );
  }

  // NOTE: MentionTextarea does not expose its internal textarea DOM node to
  // the parent, so cursor-position-aware insertion is not possible here.
  // Emoji is appended at the end of the body instead (accepted simplification
  // — see spec Section 8/24 risk 1).
  const insertEmoji = useCallback((emojiData) => {
    setBody((prev) => prev + emojiData.emoji);
  }, []);

  // ── Typing ───────────────────────────────────────────────────────────────
  const handleChange = useCallback(
    (newValue) => {
      setBody(newValue);
      if (!isTypingRef.current) { isTypingRef.current = true; onTyping?.(true); }
      clearTimeout(typingTimeout.current);
      typingTimeout.current = setTimeout(() => { isTypingRef.current = false; onTyping?.(false); }, 2000);
    },
    [onTyping],
  );

  // ── Send ─────────────────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    const trimmed = body.trim();
    const hasFiles = pendingFiles.length > 0;
    const hasEntityRefs = pendingEntityRefs.length > 0;
    if ((!trimmed && !hasFiles && !hasEntityRefs) || isSending) return;

    clearTimeout(typingTimeout.current);
    isTypingRef.current = false;
    onTyping?.(false);
    setIsSending(true);
    setShowEmoji(false);

    try {
      const results = await Promise.allSettled(
        pendingFiles.map((f) => uploadingRef.current[f.localId]).filter(Boolean),
      );
      const attachmentIds = results
        .filter((r) => r.status === "fulfilled" && r.value)
        .map((r) => r.value);

      // The voice-note auto-send fires the instant the recording is queued,
      // before its upload settles — if that upload failed (e.g. an iOS-only
      // upload error) this used to still go through as a blank, attachment-
      // less message while the errored card sat there unexplained. Bail and
      // leave the card (with its new "Reintentar" button) in place instead.
      if (hasFiles && attachmentIds.length === 0 && !trimmed && !hasEntityRefs) {
        toast.error("No se pudo enviar el archivo. Usa \"Reintentar\" en la vista previa.");
        return;
      }

      await onSend({
        body: trimmed || null,
        messageType: hasFiles && !trimmed ? "file" : "text",
        attachmentIds,
        // Local previews so the optimistic bubble can show (and open) the
        // image/file being sent while the server round-trips — swapped for the
        // real signed-URL attachments on success. blob: URLs pass
        // isSignedUrlUsable so useAttachmentUrl serves them directly.
        optimisticAttachments: pendingFiles.map((f) => ({
          id: `temp-att-${f.localId}`,
          fileName: f.file?.name ?? "archivo",
          mimeType: f.file?.type ?? "",
          sizeBytes: f.file?.size ?? 0,
          url: f.objectUrl ?? null,
        })),
        // Only entityType/recordId — never the client-side echo `label`,
        // which the backend never reads and always re-derives the real
        // title/subtitle/url from the target module's own service.
        entityRefs: pendingEntityRefs.map(({ entityType, recordId }) => ({ entityType, recordId })),
        replyToMessageId: replyingTo?.id ?? undefined,
      });

      // Delay the revoke so the optimistic bubble's blob preview outlives the
      // temp -> real message swap (avoids a broken-image flicker).
      const toRevoke = pendingFiles.map((f) => f.objectUrl).filter(Boolean);
      if (toRevoke.length) {
        setTimeout(() => {
          for (const u of toRevoke) {
            URL.revokeObjectURL(u);
            objectUrlsRef.current.delete(u);
          }
        }, 4000);
      }
      for (const f of pendingFiles) sentLocalIdsRef.current.add(f.localId);
      setBody("");
      setPendingFiles([]);
      setPendingEntityRefs([]);
      onCancelReply?.();
    } finally {
      setIsSending(false);
    }
  }, [body, isSending, onSend, onTyping, pendingFiles, pendingEntityRefs, replyingTo, onCancelReply]);

  // Keep ref in sync so the auto-send effect never holds a stale closure.
  useEffect(() => {
    handleSendRef.current = handleSend;
  }, [handleSend]);

  // Refocus the textarea once a send completes — runs after the DOM commit
  // (isSending flips back to false, lifting the `disabled` attribute), so
  // .focus() actually lands instead of silently no-op'ing on a disabled field.
  // MentionTextarea now forwards its internal textarea's imperative handle
  // (see packages/ui/src/components/MentionTextarea.jsx), which is what
  // makes this possible — it previously had no ref to focus at all.
  useEffect(() => {
    if (wasSendingRef.current && !isSending) mentionTaRef.current?.focus();
    wasSendingRef.current = isSending;
  }, [isSending]);

  // Focus the input the moment a reply target is picked (swipe / long-press /
  // menu / right-click all set replyingTo), so the user can type immediately.
  useEffect(() => {
    if (replyingTo) mentionTaRef.current?.focus?.();
  }, [replyingTo]);

  // ── Voice auto-send ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!voiceAutoSendRef.current) return;
    if (pendingFiles.length === 0) return;
    voiceAutoSendRef.current = false;
    handleSendRef.current();
  }, [pendingFiles]);

  const handleKeyDown = useCallback(
    (e) => {
      // On touch devices Enter is a line break; sending is the send button
      // (matches WhatsApp / Telegram / every mobile chat). Only Enter-to-send
      // on a real keyboard.
      if (coarse) return;
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
    },
    [handleSend, coarse],
  );

  function handleFileInputChange(e) {
    if (e.target.files?.length) addFilesToQueue(Array.from(e.target.files));
    e.target.value = "";
  }

  // Paste an image straight from the clipboard (screenshot, "copy image", a
  // copied file) into the composer — same queue as the picker and drag-drop.
  // Only swallow the paste when it actually carried files; a normal text paste
  // still lands in the textarea.
  function handlePaste(e) {
    const dt = e.clipboardData;
    if (!dt) return;
    const files = [];
    for (const item of dt.items ?? []) {
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file && file.size > 0) files.push(file);
      }
    }
    if (files.length === 0 && dt.files?.length) files.push(...Array.from(dt.files));
    if (files.length === 0) return;
    e.preventDefault();
    addFilesToQueue(files);
  }

  // ChatWindow.jsx wraps the whole message area (composer included) in its
  // own drag-and-drop zone, calling this same addFilesToQueue via the
  // composer ref's addFiles(). Without stopPropagation, dropping directly
  // on the composer fired BOTH this handler and ChatWindow's — since a drop
  // event bubbles up through the DOM — queuing every dropped file twice and
  // showing both drop-zone overlays stacked on top of each other at once.
  function handleDragOver(e) { e.preventDefault(); e.stopPropagation(); setIsDragOver(true); }
  function handleDragLeave(e) {
    e.stopPropagation();
    if (!e.currentTarget.contains(e.relatedTarget)) setIsDragOver(false);
  }
  function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) addFilesToQueue(files);
  }

  const iconSize = compact ? "h-3.5 w-3.5" : "h-4 w-4";
  const btnSize = compact ? "h-6 w-6" : "h-8 w-8";

  return (
    <div className={[
      "w-full min-w-0 shrink-0 bg-[hsl(var(--surface-2))]",
      // Device geometry must stay outside chat-scale-target: zooming text
      // must not enlarge the space reserved for the iOS home indicator.
      edgeInset ? "safe-bottom" : "",
    ].join(" ")}>
    <div
      className={[
        "chat-scale-target relative w-auto min-w-0 max-w-full shrink-0 overflow-x-hidden border-t border-[hsl(var(--border))] transition-colors",
        // Horizontal padding + top padding only here — padding-bottom is set
        // exactly once, on its own line below, so a plain `pb-*` and an
        // `env()` calc never both compile to `padding-bottom` at equal
        // specificity (whichever lands later in the sheet would silently win).
        compact ? "px-2 pt-1.5" : "px-3 pt-2 sm:px-4 sm:pt-3",
        // The unscaled wrapper owns the device inset. Embedded composers
        // (threads and mini windows) retain their ordinary bottom padding.
        edgeInset
          ? "pb-0"
          : (compact ? "pb-1.5" : "pb-2 sm:pb-3"),
        // A single background class (never both at once). surface-2 (not raw
        // --background) so the bar reads as a distinct composer surface and,
        // crucially, its safe-area bottom inset blends with the bar instead
        // of showing as a band of page background below the input on
        // iOS/tablet PWA.
        !dropZoneDisabled && isDragOver ? "bg-[hsl(var(--primary)/0.05)]" : "bg-[hsl(var(--surface-2))]",
      ].join(" ")}
      onDragOver={dropZoneDisabled ? undefined : handleDragOver}
      onDragLeave={dropZoneDisabled ? undefined : handleDragLeave}
      onDrop={dropZoneDisabled ? undefined : handleDrop}
    >
      {/* Drop overlay — skipped entirely when a parent (ChatWindow,
          MiniChatWindow) already owns the drop zone for this whole area;
          see the dropZoneDisabled prop comment above. */}
      {!dropZoneDisabled && isDragOver && <DropZoneOverlay compact={compact} />}

      {/* Reply-to preview — the message the next send will quote */}
      {replyingTo && (
        <MessageQuote
          variant="compose"
          reply={toReplyPreview(replyingTo)}
          onCancel={onCancelReply}
        />
      )}

      {/* Recording error */}
      {recordingError && (
        <div className="flex items-center gap-1.5 mb-1.5 text-red-500 text-xs">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span>{recordingError}</span>
        </div>
      )}

      {/* Attachment previews */}
      {pendingFiles.length > 0 && (
        <div
          className="flex gap-2 overflow-x-auto pb-1 mb-2"
          style={{ scrollbarWidth: "none" }}
        >
          {pendingFiles.map((entry) => (
            <AttachmentPreviewCard
              key={entry.localId}
              entry={entry}
              onRemove={removeFile}
              onOpen={openPendingViewer}
              onRetry={() => startUpload(entry)}
            />
          ))}
        </div>
      )}

      {/* Pending entity reference chips */}
      {pendingEntityRefs.length > 0 && (
        <div
          className="flex gap-2 overflow-x-auto pb-1 mb-2"
          style={{ scrollbarWidth: "none" }}
        >
          {pendingEntityRefs.map((ref) => {
            const Icon = ENTITY_REF_ICON[ref.entityType] ?? Link2;
            return (
              <div
                key={`${ref.entityType}:${ref.recordId}`}
                className="relative flex items-center gap-1.5 bg-[hsl(var(--muted))] rounded-full pl-2.5 pr-7 py-1.5 shrink-0 max-w-45"
              >
                <Icon className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" />
                <span className="text-xs font-medium truncate">{ref.label}</span>
                <button
                  type="button"
                  onClick={() => removeEntityRef(ref.entityType, ref.recordId)}
                  className="absolute top-1/2 -translate-y-1/2 right-1.5 h-4 w-4 rounded-full bg-black/10 hover:bg-black/20 flex items-center justify-center transition-colors touch-manipulation"
                  aria-label="Quitar referencia"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Recording mode ── */}
      {recording ? (
        <div className="chat-glass flex items-center gap-2 rounded-2xl px-3 py-2">
          {/* Cancel */}
          <button
            type="button"
            onClick={() => stopRecording(true)}
            className="shrink-0 flex items-center justify-center rounded-full border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:text-red-500 hover:border-red-400 transition-colors touch-manipulation h-8 w-8"
            title="Cancelar nota de voz"
          >
            <X className="h-4 w-4" />
          </button>

          {/* Red pulse dot + timer */}
          <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse shrink-0" />
          <span className="text-sm font-mono tabular-nums flex-1 text-center">
            {formatDuration(recordSeconds)}
          </span>

          {/* Send */}
          <button
            type="button"
            onClick={() => stopRecording(false)}
            className="shrink-0 flex items-center justify-center rounded-full bg-(--brand-primary) text-(--brand-primary-foreground) hover:opacity-90 active:scale-95 transition-[opacity,transform] touch-manipulation h-8 w-8"
            title="Enviar nota de voz"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div className="chat-glass flex w-full min-w-0 max-w-full flex-col overflow-hidden rounded-2xl">
          {/* Textarea (with @mention autocomplete) — its own full-width row,
              above the action toolbar, so typing space is never squeezed by
              icons sitting beside it. MentionTextarea bakes a boxed look
              (border/bg/rounded/padding/focus-ring) into its own fixed
              className string, but it does forward an extra `className` onto
              that same element — Tailwind v4's trailing-`!` important
              modifier (already used elsewhere in this codebase, e.g.
              ProductImageManager.jsx) reliably wins regardless of class
              declaration order, so this neutralizes the boxed look and
              restores the original flat/transparent inline style, including
              the compact-vs-full sizing the old plain <textarea> had.

              The wrapping div's min-w-0 is load-bearing, not decorative: this
              is now a flex COLUMN item (it used to be a row item with its own
              flex-1 min-w-0 wrapper, removed in the toolbar-below redesign).
              A flex item's default min-width is `auto` (= its content's
              intrinsic width), so without min-w-0 a long unbroken run of
              characters (no spaces to wrap on) makes this item — and the
              textarea inside it via width:100% — grow to fit that content
              instead of wrapping, blowing out the composer and the page's
              horizontal bounds. */}
          <div className="w-full min-w-0 max-w-full overflow-hidden">
            <MentionTextarea
              ref={mentionTaRef}
              value={body}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              members={mentionMembers}
              placeholder={placeholder}
              // Rests at 1 line now (was a fixed 3, always tall even empty)
              // and grows with content up to maxRows, per the redesign ask.
              rows={1}
              maxRows={compact ? 3 : 6}
              disabled={disabled || isSending}
              // text-base! (16px) on mobile is mandatory, not cosmetic — anything
              // smaller makes iOS/Android auto-zoom the whole page on focus (see
              // .github/instructions/responsive-mobile.instructions.md). The
              // previous text-xs!/text-sm! here was exactly that bug.
              className={[
                "w-full! min-w-0! max-w-full! overflow-x-hidden! border-0! bg-transparent! rounded-none! shadow-none! ring-0! focus:ring-0! leading-tight break-words! [overflow-wrap:anywhere]!",
                compact ? "text-base! sm:text-xs! px-2! pt-1.5! pb-0.5!" : "text-base! sm:text-sm! px-3! pt-2.5! pb-1!",
              ].join(" ")}
            />
          </div>

          {/* Mobile quick-emoji strip — a normal in-flow row (full composer
              width) so it can never render off-screen the way the Popover
              could inside a bottom-anchored Sheet. The trailing "+" opens the
              full picker in a body-portaled Dialog. */}
          {coarse && showEmoji && (
            <div className="flex w-full items-center gap-1 overflow-x-auto overscroll-x-contain px-2 pb-1 pt-0.5">
              {QUICK_EMOJIS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => { insertEmoji({ emoji: e }); setShowEmoji(false); }}
                  className="shrink-0 h-9 w-9 rounded-full text-xl leading-none flex items-center justify-center hover:bg-[hsl(var(--border))] active:scale-95 transition-transform touch-manipulation"
                  aria-label={`Insertar ${e}`}
                >
                  {e}
                </button>
              ))}
              <button
                type="button"
                onClick={() => { setShowEmoji(false); setEmojiModalOpen(true); }}
                className="shrink-0 h-9 w-9 rounded-full flex items-center justify-center text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--border))] hover:text-[hsl(var(--foreground))] transition-colors touch-manipulation"
                aria-label="Ver todos los emojis"
                title="Mas emojis"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* Action toolbar — attach / reference / emoji / mic grouped on the
              left, send separated on the far right. Previously these lived
              inline next to the textarea inside one pill-shaped row, which
              both looked cluttered and ate into the width available for
              typing. */}
          <div className={["flex w-full min-w-0 max-w-full items-center gap-0.5 overflow-hidden", compact ? "px-1 pb-1" : "px-1.5 pb-1.5"].join(" ")}>
            {/* Paperclip */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,audio/*,video/*,application/pdf,text/plain,application/msword,application/vnd.openxmlformats-officedocument.*,application/zip"
              className="hidden"
              onChange={handleFileInputChange}
              disabled={disabled}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className={[
                "shrink-0 flex items-center justify-center rounded-full text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--border))] transition-colors touch-manipulation",
                btnSize,
              ].join(" ")}
              title="Adjuntar archivo"
              disabled={disabled}
            >
              <Paperclip className={iconSize} />
            </button>

            {/* Entity reference — hidden entirely in external_support
                conversations (spec Non-goal 3); this is composer-level
                enforcement only, Plan A's backend Zod validation is the real
                safety net. */}
            {canAttachEntityRefs && (
              <EntityReferencePicker
                open={showEntityPicker}
                onOpenChange={setShowEntityPicker}
                onPick={addEntityRef}
                maxSelect={MAX_ENTITY_REFS - pendingEntityRefs.length}
              >
                <button
                  type="button"
                  onClick={() => setShowEntityPicker((v) => !v)}
                  disabled={disabled || pendingEntityRefs.length >= MAX_ENTITY_REFS}
                  className={[
                    "shrink-0 flex items-center justify-center rounded-full transition-colors touch-manipulation",
                    btnSize,
                    showEntityPicker
                      ? "text-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.1)]"
                      : "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--border))]",
                  ].join(" ")}
                  title={
                    pendingEntityRefs.length >= MAX_ENTITY_REFS
                      ? "Maximo 5 referencias por mensaje"
                      : "Referenciar registro"
                  }
                >
                  <Link2 className={iconSize} />
                </button>
              </EntityReferencePicker>
            )}

            {/* Emoji — a portaled Popover (same pattern as
                MessageReactionPicker.jsx), not an in-flow `absolute` div. The
                composer's own wrapper sets `overflow-x-hidden`, which per the
                CSS overflow spec silently forces `overflow-y` to `auto` too;
                combined with the Sheet ancestor's own overflow/height clipping
                (ThreadPanel, MessageActionSheet), an in-flow popup positioned
                `bottom-full` never had anywhere valid to paint outside those
                boxes. A Radix Popover portals to <body> and is immune to any
                of that. */}
            <Popover open={showEmoji && !coarse} onOpenChange={(o) => { if (!coarse) setShowEmoji(o); }}>
              <PopoverAnchor asChild>
                <button
                  type="button"
                  onClick={() => setShowEmoji((v) => !v)}
                  disabled={disabled}
                  className={[
                    "shrink-0 flex items-center justify-center rounded-full transition-colors touch-manipulation",
                    btnSize,
                    showEmoji
                      ? "text-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.1)]"
                      : "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--border))]",
                  ].join(" ")}
                  title="Emojis"
                >
                  <Smile className={iconSize} />
                </button>
              </PopoverAnchor>
              <PopoverContent
                side="top"
                align="start"
                sideOffset={8}
                collisionPadding={12}
                // overflow-y-auto (not -hidden) + a max-height clamped to
                // Radix's own collision-aware available-height variable: in
                // a cramped anchor point (this button sits near the bottom of
                // an 85dvh Sheet) Radix can end up with less room than the
                // picker's own requested height, and the library's internal
                // virtualized list has been seen to lock in whatever height
                // it first measures — silently truncating with no working
                // scroll of its own. This outer scroll is a plain div, so it
                // always responds to wheel/touch regardless of what the
                // picker's internal scroll area is doing.
                className="w-auto max-w-[calc(100vw-1rem)] p-0 overflow-y-auto rounded-xl"
                style={{ maxHeight: "var(--radix-popover-content-available-height, 360px)" }}
                onOpenAutoFocus={(e) => e.preventDefault()}
              >
                <ThemedEmojiPicker
                  onEmojiClick={insertEmoji}
                  width={compact ? "min(230px, calc(100vw - 1rem))" : "min(300px, calc(100vw - 1.5rem))"}
                  height={compact ? 280 : 360}
                />
              </PopoverContent>
            </Popover>

            {/* Full emoji picker for touch — a body-portaled Dialog, opened
                from the "+" in the quick strip. Immune to the Sheet-anchor
                clipping that could push the Popover off-screen on mobile. */}
            <Dialog open={emojiModalOpen} onOpenChange={setEmojiModalOpen}>
              <DialogContent className="max-w-[calc(100vw-1.5rem)] sm:max-w-md p-0 overflow-hidden bg-[hsl(var(--popover,var(--background)))]">
                <DialogHeader className="px-4 pt-4 pb-1">
                  <DialogTitle className="text-sm">Emojis</DialogTitle>
                </DialogHeader>
                <ThemedEmojiPicker
                  className="px-1.5 pb-1.5"
                  onEmojiClick={(ed) => { insertEmoji(ed); setEmojiModalOpen(false); }}
                  width="100%"
                  height={360}
                />
              </DialogContent>
            </Dialog>

            {/* Mic — only shown when there's nothing else ready to send */}
            {!body.trim() && !pendingFiles.length && !pendingEntityRefs.length && (
              <button
                type="button"
                onClick={startRecording}
                disabled={disabled}
                className={[
                  "shrink-0 flex items-center justify-center rounded-full text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--border))] transition-colors touch-manipulation",
                  btnSize,
                ].join(" ")}
                title="Nota de voz"
              >
                <Mic className={iconSize} />
              </button>
            )}

            <div className="flex-1" />

            {/* Send */}
            <Button
              size="sm"
              className={["shrink-0 rounded-full p-0 touch-manipulation", btnSize].join(" ")}
              onClick={handleSend}
              onMouseDown={(e) => e.preventDefault()}
              disabled={(!body.trim() && !pendingFiles.length && !pendingEntityRefs.length) || isSending || disabled}
            >
              {isSending ? (
                <Loader2 className={compact ? "h-3 w-3 animate-spin" : "h-3.5 w-3.5 animate-spin"} />
              ) : (
                <Send className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} />
              )}
            </Button>
          </div>
        </div>
      )}

      {!compact && (
        <p className="text-[10px] text-[hsl(var(--muted-foreground))] mt-1 ml-1 hidden sm:block">
          Intro para enviar · Shift+Intro para nueva linea
        </p>
      )}

      <ChatAttachmentViewer
        open={attView.open}
        onOpenChange={(open) => setAttView((v) => ({ ...v, open }))}
        attachments={mapPendingToViewerFiles(pendingFiles)}
        activeIndex={attView.index}
        onIndexChange={(i) => setAttView((v) => ({ ...v, index: i }))}
        resolveUrl={async (f) => f.url ?? null}
        canOpenInOffice={() => false}
        onOpenInOffice={() => {}}
      />
    </div>
    </div>
  );
});
