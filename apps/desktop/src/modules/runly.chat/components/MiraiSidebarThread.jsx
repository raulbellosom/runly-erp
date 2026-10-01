// apps/desktop/src/modules/runly.chat/components/MiraiSidebarThread.jsx
//
// Message thread for the global MirAI sidebar (spec
// 2026-09-30-mirai-global-capabilities §7). Reuses the user's single MirAI
// conversation — the same one used by full Chat and the "ask about this
// conversation" panel — and tags outgoing messages with the current screen's
// page context so MirAI's module tools know what the user is looking at.
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button, Textarea, EmptyState, AssistantWordmark, renderRichText } from "@runly/ui";
import { Sparkles, Send, X, ExternalLink, Paperclip } from "lucide-react";
import { toast } from "sonner";
import { useEnsureMiraiConversation } from "../hooks/useMirAI";
import { useChatMessages, useSendMessage } from "../hooks/useChatMessages";
import { useChatPresence } from "../hooks/useChatPresence";
import { useChatUpload } from "../hooks/useChatUpload";
import { MiraiProposalCard } from "./MiraiProposalCard";
import { AttachmentPreviewCard } from "./AttachmentPreviewCard";
import { MIRAI_NAME, MIRAI_TYPING_SENTINEL } from "../lib/mirai";
import { buildMiraiPageContext, useCurrentMiraiRecord } from "../lib/miraiPageContext";

const EXAMPLE_PROMPTS = [
  "Qué huecos libres tengo mañana",
  "Cuántas horas de reuniones tuve esta semana",
  "Agenda una reunión mañana a las 10",
];

// Same formats/limits as the backend attachment reader (spec
// 2026-09-30-mirai-inventory-capability-design.md §2): up to 5 files, 10 MB
// each, 20 MB total.
const MAX_FILES = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const ALLOWED_FILE_RE = /\.(png|jpe?g|webp|heic|pdf|txt|csv|md|docx|xlsx)$/i;

function Bubble({ role, content }) {
  const isUser = role === "user";
  return (
    <div className={["flex", isUser ? "justify-end" : "justify-start"].join(" ")}>
      <div
        className={[
          "min-w-0 max-w-[85%] wrap-anywhere rounded-2xl px-3 py-2 text-sm",
          isUser
            ? "whitespace-pre-wrap bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
            : "bg-[hsl(var(--muted))] text-[hsl(var(--foreground))]",
        ].join(" ")}
      >
        {renderRichText(content, { paragraphClassName: isUser ? "whitespace-pre-wrap wrap-anywhere" : "text-left whitespace-pre-wrap wrap-anywhere" })}
      </div>
    </div>
  );
}

export function MiraiSidebarThread({ onClose }) {
  const location = useLocation();
  const navigate = useNavigate();
  const currentRecord = useCurrentMiraiRecord();

  const { data: ensureData } = useEnsureMiraiConversation();
  const conversationId = ensureData?.conversationId ?? null;

  const { data, isLoading } = useChatMessages(conversationId);
  const send = useSendMessage(conversationId);
  const { uploadFile, deleteUpload } = useChatUpload(conversationId);
  const { typingUsersList } = useChatPresence(conversationId);
  const miraiTyping = typingUsersList.includes(MIRAI_TYPING_SENTINEL);

  const messages = data?.data ?? [];
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

  function openInChat() {
    if (!conversationId) return;
    navigate(`/app/m/runly.chat/chat/inbox/${conversationId}`);
    onClose?.();
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
    } catch (err) {
      toast.error(err?.message ?? "No se pudo enviar el mensaje.");
    }
  }

  return (
    <>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[hsl(var(--border))] p-3">
        <span className="flex items-center gap-1.5 text-sm font-semibold">
          <Sparkles className="h-4 w-4 text-[hsl(var(--primary))]" />
          <AssistantWordmark />
        </span>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={!conversationId} onClick={openInChat}>
            <ExternalLink className="mr-1 h-3.5 w-3.5" />
            Abrir en Chat
          </Button>
          <Button size="icon" variant="ghost" aria-label="Cerrar" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex-1 min-h-0 space-y-3 overflow-y-auto p-3">
        {isLoading && (
          <p className="text-center text-xs text-[hsl(var(--muted-foreground))]">Cargando…</p>
        )}

        {!isLoading && !messages.length && (
          <EmptyState
            icon={Sparkles}
            title={`Pregúntale a ${MIRAI_NAME}`}
            description="Puedo consultar tus módulos, analizar datos y proponer acciones."
          >
            <div className="mt-3 w-full space-y-2">
              {EXAMPLE_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => setDraft(prompt)}
                  className="block w-full rounded-lg border border-[hsl(var(--border))] px-3 py-2 text-left text-xs text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </EmptyState>
        )}

        {messages.map((m, i) => (m.sender_type === "system" ? (
          <p key={m.id ?? i} className="text-center text-xs text-[hsl(var(--muted-foreground))]">{m.body}</p>
        ) : (
          <div key={m.id ?? i}>
            <Bubble role={m.sender_type === "user" ? "user" : "assistant"} content={m.body ?? ""} />
            {m.attachments?.length > 0 && (
              <div className={["mt-1 flex flex-wrap gap-1", m.sender_type === "user" ? "justify-end" : "justify-start"].join(" ")}>
                {m.attachments.map((att) => (
                  <span
                    key={att.id}
                    className="inline-flex max-w-[85%] items-center gap-1 truncate rounded-full bg-[hsl(var(--muted))] px-2 py-0.5 text-[10px] text-[hsl(var(--muted-foreground))]"
                  >
                    <Paperclip className="h-2.5 w-2.5 shrink-0" />
                    <span className="truncate">{att.fileName}</span>
                  </span>
                ))}
              </div>
            )}
            {m.metadata?.miraiProposalId && (
              <div className="pl-1">
                <MiraiProposalCard proposalId={m.metadata.miraiProposalId} conversationId={conversationId} />
              </div>
            )}
          </div>
        )))}

        {miraiTyping && (
          <p className="px-1 text-xs italic text-[hsl(var(--muted-foreground))]">{MIRAI_NAME} está escribiendo…</p>
        )}

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
        <p className="mt-1 text-[10px] text-[hsl(var(--muted-foreground))]">Enter para enviar · Shift+Enter para nueva línea</p>
      </div>
    </>
  );
}
