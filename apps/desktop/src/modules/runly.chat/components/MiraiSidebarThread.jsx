// apps/desktop/src/modules/runly.chat/components/MiraiSidebarThread.jsx
//
// One MirAI conversation inside the global sidebar (spec
// 2026-10-01-mirai-sidebar-v2 §3): messages with the Chat module's attachment
// rendering and viewer, proposal cards, typing dots and a composer with
// paste / drag-and-drop attachments. Outgoing messages carry the current
// screen's page context. The header (back, title, close) is drawn by
// ModuleAssistantPanel in MiraiSidebarHost.
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Button, Textarea, EmptyState, Skeleton, renderRichText } from "@runly/ui";
import { Sparkles, Send, Paperclip } from "lucide-react";
import { toast } from "sonner";
import { useChatMessages, useSendMessage } from "../hooks/useChatMessages";
import { useChatPresence } from "../hooks/useChatPresence";
import { useChatUpload } from "../hooks/useChatUpload";
import { MiraiProposalCard } from "./MiraiProposalCard";
import { EntityReferenceCard } from "./EntityReferenceCard";
import { AttachmentPreviewCard } from "./AttachmentPreviewCard";
import { AttachmentsBlock } from "./MessageAttachments";
import { ChatAttachmentViewer } from "./ChatAttachmentViewer";
import { buildAllAttachments } from "../lib/chatUtils";
import { MIRAI_NAME, MIRAI_TYPING_SENTINEL } from "../lib/mirai";
import { buildMiraiPageContext, moduleKeyFromPath, useCurrentMiraiRecord } from "../lib/miraiPageContext";
import { miraiPromptsFor } from "../lib/miraiPrompts";
import { useChatPreferences } from "../hooks/useChatPreferences";

// Same formats/limits as the backend attachment reader (spec
// 2026-09-30-mirai-inventory-capability-design.md §2): up to 5 files, 10 MB
// each, 20 MB total.
const MAX_FILES = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const ALLOWED_FILE_RE = /\.(png|jpe?g|webp|heic|pdf|txt|csv|md|docx|xlsx)$/i;

function BotAvatar() {
  return (
    <div
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
      style={{ backgroundColor: "var(--brand-primary)", color: "var(--brand-primary-foreground)" }}
    >
      <Sparkles className="h-3.5 w-3.5" />
    </div>
  );
}

function TypingDots() {
  return (
    <div className="flex items-center gap-2" aria-live="polite">
      <BotAvatar />
      <div className="flex gap-1 rounded-2xl bg-[hsl(var(--muted))] px-3 py-2.5" aria-label={`${MIRAI_NAME} está escribiendo`}>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="inline-block h-1.5 w-1.5 rounded-full bg-[hsl(var(--muted-foreground))] motion-safe:animate-bounce"
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </div>
    </div>
  );
}

function Bubble({ role, content }) {
  const isUser = role === "user";
  if (!content) return null;
  return (
    <div className={["flex items-end gap-2", isUser ? "justify-end" : "justify-start"].join(" ")}>
      {!isUser && <BotAvatar />}
      <div
        className={[
          "min-w-0 max-w-[85%] wrap-anywhere rounded-2xl px-3 py-2 text-sm",
          isUser
            ? "whitespace-pre-wrap bg-(--brand-primary) text-(--brand-primary-foreground)"
            : "bg-[hsl(var(--muted))] text-[hsl(var(--foreground))]",
        ].join(" ")}
      >
        {renderRichText(content, { paragraphClassName: isUser ? "whitespace-pre-wrap wrap-anywhere" : "text-left whitespace-pre-wrap wrap-anywhere" })}
      </div>
    </div>
  );
}

export function MiraiSidebarThread({ conversationId, onSent }) {
  const location = useLocation();
  const currentRecord = useCurrentMiraiRecord();
  const prompts = miraiPromptsFor(moduleKeyFromPath(location.pathname));
  const { prefs } = useChatPreferences();

  const { data, isLoading } = useChatMessages(conversationId);
  const send = useSendMessage(conversationId);
  const { uploadFile, deleteUpload } = useChatUpload(conversationId);
  const { typingUsersList } = useChatPresence(conversationId);
  // Optimistic "escribiendo": shown from the moment the message is sent until
  // MirAI's reply (or a system note) lands, so the wait never looks idle.
  // Holds the id of the last non-user message seen at send time.
  const [awaitingAfter, setAwaitingAfter] = useState(null);
  const miraiTyping = typingUsersList.includes(MIRAI_TYPING_SENTINEL) || awaitingAfter !== null;

  const messages = data?.data ?? [];
  const lastReply = [...messages].reverse().find((m) => m.sender_type !== "user");
  const lastReplyId = lastReply?.id ?? "none";
  useEffect(() => {
    if (awaitingAfter === null) return undefined;
    if (lastReplyId !== awaitingAfter) {
      setAwaitingAfter(null);
      return undefined;
    }
    const timer = setTimeout(() => setAwaitingAfter(null), 120_000);
    return () => clearTimeout(timer);
  }, [awaitingAfter, lastReplyId]);
  const allAttachments = useMemo(() => buildAllAttachments(messages), [messages]);
  const [viewer, setViewer] = useState({ open: false, activeIndex: 0 });
  const [dragging, setDragging] = useState(false);
  const [draft, setDraft] = useState("");
  const [pendingFiles, setPendingFiles] = useState([]);
  const listEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const objectUrlsRef = useRef(new Set());
  const uploadingRef = useRef({});
  // Latest pendingFiles, readable from the unmount cleanup closure below
  // without making it re-run on every queue change.
  const pendingFilesRef = useRef([]);
  useEffect(() => { pendingFilesRef.current = pendingFiles; }, [pendingFiles]);

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, miraiTyping]);

  // Discard any upload that finished but was never sent (panel closed with
  // files still queued) — mirrors MessageComposer's unmount cleanup.
  useEffect(() => {
    return () => {
      for (const objectUrl of objectUrlsRef.current) URL.revokeObjectURL(objectUrl);
      objectUrlsRef.current.clear();
      for (const entry of pendingFilesRef.current) {
        if (entry.attachmentId) deleteUpload(entry.attachmentId).catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openAttachment(list, index) {
    const clickedId = list?.[index]?.id;
    const globalIdx = allAttachments.findIndex((f) => f.id === clickedId);
    setViewer({ open: true, activeIndex: globalIdx >= 0 ? globalIdx : 0 });
  }

  // Clipboard images arrive as "image.png"; give them unique names.
  function handlePaste(e) {
    const files = Array.from(e.clipboardData?.files ?? []);
    if (!files.length) return;
    e.preventDefault();
    addFilesToQueue(files.map((f, i) => (f.name && f.name !== "image.png"
      ? f
      : new File([f], `imagen-pegada-${Date.now()}-${i}.${(f.type.split("/")[1] || "png").replace("jpeg", "jpg")}`, { type: f.type }))));
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer?.files?.length) addFilesToQueue(e.dataTransfer.files);
  }

  function startUpload(entry) {
    const promise = uploadFile(entry.file)
      .then((attachmentId) => {
        setPendingFiles((prev) =>
          prev.map((f) => (f.localId === entry.localId ? { ...f, uploading: false, done: true, attachmentId } : f)),
        );
        return attachmentId;
      })
      .catch((err) => {
        setPendingFiles((prev) =>
          prev.map((f) =>
            f.localId === entry.localId ? { ...f, uploading: false, error: err?.message ?? "Error al subir" } : f,
          ),
        );
        return null;
      });
    uploadingRef.current[entry.localId] = promise;
  }

  function addFilesToQueue(files) {
    const incoming = Array.from(files ?? []);
    if (!incoming.length || !conversationId) return;
    const currentTotal = pendingFiles.reduce((sum, f) => sum + (f.file?.size ?? 0), 0);
    const nextTotal = currentTotal + incoming.reduce((sum, f) => sum + f.size, 0);
    if (pendingFiles.length + incoming.length > MAX_FILES || nextTotal > MAX_TOTAL_BYTES
      || incoming.some((f) => f.size > MAX_FILE_BYTES)) {
      toast.error("Máximo 5 archivos, 10 MB por archivo y 20 MB en total.");
      return;
    }
    if (incoming.some((f) => !ALLOWED_FILE_RE.test(f.name))) {
      toast.error("Usa imágenes, PDF, Word DOCX, Excel XLSX, TXT, CSV o Markdown.");
      return;
    }
    const entries = incoming.map((file) => {
      const objectUrl = URL.createObjectURL(file);
      objectUrlsRef.current.add(objectUrl);
      return { localId: `${Date.now()}-${Math.random()}`, file, objectUrl, uploading: true, done: false, error: null, attachmentId: null };
    });
    setPendingFiles((prev) => [...prev, ...entries]);
    for (const entry of entries) startUpload(entry);
  }

  function removeFile(localId) {
    const entry = pendingFiles.find((f) => f.localId === localId);
    if (entry?.objectUrl) {
      URL.revokeObjectURL(entry.objectUrl);
      objectUrlsRef.current.delete(entry.objectUrl);
    }
    if (entry?.attachmentId) {
      deleteUpload(entry.attachmentId).catch(() => {});
    } else if (uploadingRef.current[localId]) {
      Promise.resolve(uploadingRef.current[localId]).then((id) => id && deleteUpload(id)).catch(() => {});
    }
    setPendingFiles((prev) => prev.filter((f) => f.localId !== localId));
    delete uploadingRef.current[localId];
  }

  function handleFileInputChange(e) {
    if (e.target.files?.length) addFilesToQueue(e.target.files);
    e.target.value = "";
  }

  async function submit(text) {
    const body = (text ?? draft).trim();
    const hasFiles = pendingFiles.length > 0;
    if ((!body && !hasFiles) || send.isPending || !conversationId) return;
    setDraft("");
    const pageContext = buildMiraiPageContext(location.pathname, currentRecord);
    try {
      const results = await Promise.allSettled(
        pendingFiles.map((f) => uploadingRef.current[f.localId]).filter(Boolean),
      );
      const attachmentIds = results.filter((r) => r.status === "fulfilled" && r.value).map((r) => r.value);
      if (hasFiles && attachmentIds.length === 0 && !body) {
        toast.error("No se pudo enviar el archivo. Intenta de nuevo.");
        return;
      }
      await send.mutateAsync({
        body: body || null,
        messageType: hasFiles && !body ? "file" : "text",
        attachmentIds,
        metadata: pageContext ? { miraiPageContext: pageContext } : undefined,
      });
      for (const entry of pendingFiles) {
        if (entry.objectUrl) {
          URL.revokeObjectURL(entry.objectUrl);
          objectUrlsRef.current.delete(entry.objectUrl);
        }
        delete uploadingRef.current[entry.localId];
      }
      setPendingFiles([]);
      setAwaitingAfter(lastReplyId);
      onSent?.();
    } catch (err) {
      toast.error(err?.message ?? "No se pudo enviar el mensaje.");
    }
  }

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      onDragOver={(e) => { if (e.dataTransfer?.types?.includes("Files")) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false); }}
      onDrop={handleDrop}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-[hsl(var(--primary))] bg-[hsl(var(--background))]/85 text-sm font-medium text-[hsl(var(--primary))]">
          Suelta los archivos para adjuntarlos
        </div>
      )}
      {/* Same wallpaper as the Chat module (chat-theme.css), behind the list. */}
      <div className="chat-scale-target chat-wallpaper relative isolate flex-1 min-h-0 space-y-3 overflow-y-auto p-3">
        {prefs.wallpaper && <div className="chat-wallpaper-layer" data-accent={prefs.accentColorKey} aria-hidden="true" />}
        {(isLoading || !conversationId) && (
          <div className="space-y-3">
            <Skeleton className="h-12 w-3/4 rounded-2xl" />
            <Skeleton className="ml-auto h-10 w-1/2 rounded-2xl" />
          </div>
        )}

        {!isLoading && conversationId && messages.length <= 1 && (
          <EmptyState
            variant="compact"
            icon={Sparkles}
            title={`Pregúntale a ${MIRAI_NAME}`}
            description="Consulto y analizo tus módulos, busco en internet, leo tus archivos y preparo acciones que tú confirmas."
          >
            <div className="mt-3 w-full space-y-2">
              {prompts.map((prompt) => (
                <Button
                  key={prompt}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setDraft(prompt)}
                  className="h-auto w-full justify-start whitespace-normal py-2 text-left text-xs font-normal"
                >
                  {prompt}
                </Button>
              ))}
            </div>
          </EmptyState>
        )}

        {messages.map((m, i) => (m.sender_type === "system" ? (
          <p key={m.id ?? i} className="mx-auto max-w-[90%] rounded-full bg-[hsl(var(--muted))] px-3 py-1 text-center text-xs text-[hsl(var(--muted-foreground))]">{m.body}</p>
        ) : (
          <div key={m.id ?? i} className="space-y-1">
            <Bubble role={m.sender_type === "user" ? "user" : "assistant"} content={m.body ?? ""} />
            {m.attachments?.length > 0 && (
              <div className={["max-w-[85%]", m.sender_type === "user" ? "ml-auto" : "ml-9"].join(" ")}>
                <AttachmentsBlock
                  attachments={m.attachments}
                  onOpen={openAttachment}
                  isOwn={m.sender_type === "user"}
                  messageId={m.id}
                />
              </div>
            )}
            {m.sender_type !== "user" && m.metadata?.entityRefs?.length > 0 && (
              <div className="ml-9 flex max-w-[85%] flex-col gap-1">
                {m.metadata.entityRefs.map((ref, idx) => (
                  <EntityReferenceCard key={`${ref.entityType}:${ref.recordId}:${idx}`} reference={ref} />
                ))}
              </div>
            )}
            {m.metadata?.miraiProposalId && (
              <div className="pl-9">
                <MiraiProposalCard proposalId={m.metadata.miraiProposalId} conversationId={conversationId} />
              </div>
            )}
          </div>
        )))}

        {miraiTyping && <TypingDots />}

        <div ref={listEndRef} />
      </div>

      <div className="shrink-0 border-t border-[hsl(var(--border))] p-3">
        {pendingFiles.length > 0 && (
          <div className="mb-2 flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
            {pendingFiles.map((entry) => (
              <AttachmentPreviewCard key={entry.localId} entry={entry} onRemove={removeFile} onRetry={() => startUpload(entry)} />
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp,image/heic,application/pdf,text/plain,text/csv,text/markdown,.md,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={handleFileInputChange}
            disabled={!conversationId}
          />
          <Button
            size="icon"
            variant="ghost"
            className="h-9 w-9 shrink-0"
            aria-label="Adjuntar archivo"
            disabled={!conversationId || pendingFiles.length >= MAX_FILES}
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip className="h-4 w-4" />
          </Button>
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
            }}
            onPaste={handlePaste}
            rows={2}
            disabled={!conversationId || send.isPending}
            placeholder={`Escribe a ${MIRAI_NAME}...`}
            className="min-h-[44px] flex-1 resize-none"
          />
          <Button
            size="icon"
            className="h-9 w-9 shrink-0"
            disabled={(!draft.trim() && !pendingFiles.length) || send.isPending || !conversationId}
            onClick={() => submit()}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
        <p className="mt-1 text-[10px] text-[hsl(var(--muted-foreground))]">Enter para enviar · Shift+Enter para nueva línea · Pega o arrastra archivos</p>
      </div>

      <ChatAttachmentViewer
        open={viewer.open}
        onOpenChange={(open) => setViewer((v) => ({ ...v, open }))}
        attachments={allAttachments}
        activeIndex={viewer.activeIndex}
        onIndexChange={(i) => setViewer((v) => ({ ...v, activeIndex: i }))}
      />
    </div>
  );
}
