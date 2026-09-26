import { useEffect, useMemo, useRef, useState } from "react";
import { Send, Paperclip, X, Download, Loader2 } from "lucide-react";
import { renderRichText } from "@runly/ui";
import { groupConsecutiveBySender } from "./lib/roomChat";

// Dark-locked variant of the shared code styling (this surface never uses the
// app's --muted/--border CSS variables — see the component doc comment below).
const RICH_TEXT_CODE_CLASS = "rounded bg-white/15 px-1 py-0.5 font-mono text-[0.85em]";

function timeLabel(iso) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function formatSize(bytes) {
  if (!Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImageMime(mimeType) {
  return String(mimeType ?? "").startsWith("image/");
}

async function openAttachment(attachment, onResolveUrl) {
  if (!onResolveUrl) return;
  try {
    const data = await onResolveUrl(attachment.id);
    if (data?.url) window.open(data.url, "_blank", "noopener,noreferrer");
  } catch { /* best-effort */ }
}

// Fully-literal Tailwind strings (own/other x solo/first/last/middle) — no
// dynamic class-fragment interpolation, so the build's CSS scanner picks all
// of these up. Mirrors ChatMessageBubble.jsx's grouped-bubble "tail" effect
// (see docs/superpowers/specs/2026-09-25-guest-room-chat-visual-redesign-design.md §8)
// without depending on that component's chat-theme CSS variables.
const BUBBLE_RADIUS = {
  own: {
    solo: "rounded-2xl",
    first: "rounded-t-2xl rounded-bl-2xl rounded-br-md",
    last: "rounded-b-2xl rounded-tl-2xl rounded-tr-md",
    middle: "rounded-l-2xl rounded-r-md",
  },
  other: {
    solo: "rounded-2xl",
    first: "rounded-t-2xl rounded-br-2xl rounded-bl-md",
    last: "rounded-b-2xl rounded-tr-2xl rounded-tl-md",
    middle: "rounded-r-2xl rounded-l-md",
  },
};

function bubbleRadius(isOwn, isFirst, isLast) {
  const side = isOwn ? BUBBLE_RADIUS.own : BUBBLE_RADIUS.other;
  if (isFirst && isLast) return side.solo;
  if (isFirst) return side.first;
  if (isLast) return side.last;
  return side.middle;
}

function Avatar({ name, visible }) {
  return (
    <div
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-500/20 text-[11px] font-semibold text-violet-100 ${visible ? "" : "invisible"}`}
    >
      {(name || "?").slice(0, 1).toUpperCase()}
    </div>
  );
}

// An image attachment. `rounded` is false when it's fused into a
// caption card (AttachmentImage.jsx pattern per ChatMessageBubble's
// MediaCaptionBubble) so the outer card's own overflow-hidden + radius owns
// the corners instead of double-rounding.
function AttachmentImage({ attachment, onResolveUrl, rounded = true }) {
  const [url, setUrl] = useState(null);

  useEffect(() => {
    if (!onResolveUrl) return undefined;
    let cancelled = false;
    onResolveUrl(attachment.id).then((data) => {
      if (!cancelled) setUrl(data?.url ?? null);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [attachment.id, onResolveUrl]);

  if (!url) {
    return (
      <div className={`flex h-32 w-full items-center justify-center bg-white/5 ${rounded ? "rounded-2xl" : ""}`}>
        <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
      </div>
    );
  }
  return (
    <img
      src={url}
      alt={attachment.fileName}
      onClick={() => openAttachment(attachment, onResolveUrl)}
      className={`block max-h-64 w-full cursor-pointer object-cover ${rounded ? "rounded-2xl" : ""}`}
    />
  );
}

// A single non-image attachment. Deliberately minimal — no context menu, no
// reactions, no office-open — this is the guest's lightweight chat, not
// ChatWindow. See docs/superpowers/specs/2026-09-25-call-guest-chat-attachments-design.md §8.
function AttachmentFile({ attachment, onResolveUrl }) {
  return (
    <button
      type="button"
      onClick={() => openAttachment(attachment, onResolveUrl)}
      className="flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-left text-xs text-slate-100 hover:bg-white/15"
    >
      <Download className="h-4 w-4 shrink-0 text-slate-300" />
      <span className="min-w-0">
        <span className="block truncate font-medium">{attachment.fileName}</span>
        <span className="text-slate-400">{formatSize(attachment.sizeBytes)}</span>
      </span>
    </button>
  );
}

// One message row: avatar (only on the last message of a consecutive run
// from the same sender, else an invisible placeholder so bubbles stay
// aligned) + sender name (only on the first of the run) + the message's own
// bubble(s) + a timestamp shown once, on the last message of the run.
function MessageRow({ m, mine, onResolveAttachmentUrl }) {
  const radius = bubbleRadius(mine, m.isFirst, m.isLast);
  const images = (m.attachments ?? []).filter((a) => isImageMime(a.mimeType));
  const files = (m.attachments ?? []).filter((a) => !isImageMime(a.mimeType));
  // A caption + its first image fuse into one card (MediaCaptionBubble
  // pattern) — any further images/files on the same message render as their
  // own separate bubbles below it.
  const fused = m.body && images[0] ? images[0] : null;
  const standaloneImages = fused ? images.slice(1) : images;

  return (
    <div className={`flex items-end gap-2 ${mine ? "flex-row-reverse" : "flex-row"}`}>
      {!mine && <Avatar name={m.senderName} visible={m.isLast} />}
      <div className={`flex min-w-0 max-w-[85%] flex-col gap-1 ${mine ? "items-end" : "items-start"}`}>
        {!mine && m.isFirst && (
          <span className="px-1 text-[10px] text-slate-400">
            {m.senderName}{m.senderKind === "guest" ? " · invitado" : ""}
          </span>
        )}
        {fused ? (
          <div className={`w-full overflow-hidden ${radius} ${mine ? "bg-violet-600" : "bg-white/10"}`}>
            <AttachmentImage attachment={fused} onResolveUrl={onResolveAttachmentUrl} rounded={false} />
            <div className="px-3 py-2 text-sm text-white">
              {renderRichText(m.body, {
                codeClassName: RICH_TEXT_CODE_CLASS,
                paragraphClassName: "whitespace-pre-wrap wrap-break-word",
              })}
            </div>
          </div>
        ) : m.body ? (
          <div
            // min-w-0: flex-item of the min-w-0/items-end column above — without
            // its own min-w-0 a long unbroken run of characters still floors
            // this bubble's width at min-content and overflows past max-w-[85%].
            className={`min-w-0 px-3 py-1.5 text-sm ${radius} ${
              mine ? "bg-violet-600 text-white" : "bg-white/10 text-slate-100"
            }`}
          >
            {renderRichText(m.body, {
              codeClassName: RICH_TEXT_CODE_CLASS,
              paragraphClassName: "whitespace-pre-wrap wrap-break-word",
            })}
          </div>
        ) : null}
        {standaloneImages.map((att) => (
          <div key={att.id} className={`w-full max-w-[16rem] overflow-hidden ${bubbleRadius(mine, true, true)}`}>
            <AttachmentImage attachment={att} onResolveUrl={onResolveAttachmentUrl} />
          </div>
        ))}
        {files.map((att) => <AttachmentFile key={att.id} attachment={att} onResolveUrl={onResolveAttachmentUrl} />)}
        {m.isLast && <span className="px-1 text-[10px] text-slate-500">{timeLabel(m.createdAt)}</span>}
      </div>
    </div>
  );
}

// Presentational room chat. Supports the same *bold*/_italic_/~strike~/
// `code`/list formatting as the main chat (renderRichText) — with the same
// Ctrl/Cmd+B/I/Shift+X/Shift+M shortcuts — but deliberately still no mentions
// (this is the guest's lightweight chat; guests have no member list to
// mention) and no other HTML. File attachments are the one further exception
// (see AttachmentImage/AttachmentFile above). Always rendered inside a dark
// call surface (member CallRoom + guest GuestCallRoom, both bg-slate-950),
// and guests force a light page theme — so this component is deliberately
// dark-locked instead of using app theme tokens.
export function RoomChatView({ messages, onSend, notice, currentName, onUploadFile, onResolveAttachmentUrl }) {
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(null); // { attachmentId, fileName } | null
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const textareaRef = useRef(null);
  const [hasNewMessage, setHasNewMessage] = useState(false);
  const endRef = useRef(null);
  const listRef = useRef(null);
  const fileInputRef = useRef(null);
  // A ref (not state) so scroll events never trigger a re-render — read only
  // when a new message actually arrives, to decide whether to auto-scroll.
  const atBottomRef = useRef(true);
  const prevCountRef = useRef(messages.length);

  const grouped = useMemo(() => groupConsecutiveBySender(messages), [messages]);

  function handleScroll() {
    const el = listRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    atBottomRef.current = distance < 120;
    if (atBottomRef.current) setHasNewMessage(false);
  }

  useEffect(() => {
    const grew = messages.length > prevCountRef.current;
    prevCountRef.current = messages.length;
    if (!grew) return;
    if (atBottomRef.current) {
      endRef.current?.scrollIntoView({ block: "end" });
    } else {
      setHasNewMessage(true);
    }
  }, [messages.length]);

  function jumpToBottom() {
    endRef.current?.scrollIntoView({ block: "end" });
    setHasNewMessage(false);
  }

  async function handleFileSelect(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !onUploadFile) return;
    setUploading(true);
    setUploadError(null);
    try {
      const attachmentId = await onUploadFile(file);
      setPending({ attachmentId, fileName: file.name });
    } catch (err) {
      setUploadError(err?.message?.includes("permitido") || err?.message?.includes("grande")
        ? err.message
        : "Error subiendo el archivo.");
    } finally {
      setUploading(false);
    }
  }

  function submit(e) {
    e?.preventDefault?.();
    const t = draft.trim();
    if (!t && !pending) return;
    onSend(t, pending?.attachmentId);
    setDraft("");
    setPending(null);
  }

  // Same formatting shortcuts as the main chat composer — wraps the current
  // selection (or just places the cursor between the marks) in the marker
  // pair. This is a plain <textarea> (no MentionTextarea here), so it can
  // read/set selection directly instead of going through an imperative handle.
  function wrapDraftSelection(markStart, markEnd = markStart) {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart ?? draft.length;
    const end = ta.selectionEnd ?? draft.length;
    const before = draft.slice(0, start);
    const selected = draft.slice(start, end);
    const after = draft.slice(end);
    setDraft(`${before}${markStart}${selected}${markEnd}${after}`);
    requestAnimationFrame(() => {
      ta.focus();
      const newStart = start + markStart.length;
      ta.setSelectionRange(newStart, newStart + selected.length);
    });
  }

  function handleDraftKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) { submit(e); return; }
    const mod = e.ctrlKey || e.metaKey;
    if (!mod || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === "b") { e.preventDefault(); wrapDraftSelection("*"); return; }
    if (key === "i") { e.preventDefault(); wrapDraftSelection("_"); return; }
    if (e.shiftKey && key === "x") { e.preventDefault(); wrapDraftSelection("~"); return; }
    if (e.shiftKey && key === "m") { e.preventDefault(); wrapDraftSelection("`"); return; }
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-slate-950 text-slate-100">
      {notice && (
        <p className="shrink-0 border-b border-white/10 bg-white/5 px-3 py-1.5 text-[11px] text-slate-400">
          {notice}
        </p>
      )}
      <div ref={listRef} onScroll={handleScroll} className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-3">
        {grouped.map((m, i) => {
          const mine = m.mine || m.senderName === currentName;
          return <MessageRow key={m.id ?? `l${i}`} m={m} mine={mine} onResolveAttachmentUrl={onResolveAttachmentUrl} />;
        })}
        <div ref={endRef} />
      </div>
      {hasNewMessage && (
        <button
          type="button"
          onClick={jumpToBottom}
          className="absolute bottom-20 left-1/2 -translate-x-1/2 rounded-full bg-violet-600 px-3 py-1 text-xs text-white shadow-lg hover:bg-violet-500"
        >
          ↓ Nuevo mensaje
        </button>
      )}
      {(pending || uploading || uploadError) && (
        <div className="shrink-0 border-t border-white/10 px-3 pt-2 text-xs">
          {pending && (
            <div className="flex items-center gap-2 rounded-lg bg-white/10 px-2 py-1 text-slate-200">
              <span className="min-w-0 flex-1 truncate">{pending.fileName}</span>
              <button type="button" onClick={() => setPending(null)} title="Quitar adjunto">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          {uploading && (
            <p className="flex items-center gap-1.5 text-slate-400">
              <Loader2 className="h-3 w-3 animate-spin" /> Subiendo...
            </p>
          )}
          {uploadError && <p className="text-red-400">{uploadError}</p>}
        </div>
      )}
      <form onSubmit={submit} className="flex shrink-0 items-end gap-2 border-t border-white/10 p-2">
        {onUploadFile && (
          <>
            <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileSelect} />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading || Boolean(pending)}
              title="Adjuntar archivo"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/5 text-slate-300 transition-colors hover:bg-white/10 disabled:opacity-40"
            >
              <Paperclip className="h-4 w-4" />
            </button>
          </>
        )}
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleDraftKeyDown}
          rows={1}
          placeholder="Mensaje..."
          className="max-h-24 min-h-[38px] flex-1 resize-none rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-white/30"
        />
        <button
          type="submit"
          disabled={!draft.trim() && !pending}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-600 text-white transition-colors hover:bg-violet-500 disabled:opacity-40"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
