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
import { Sparkles, Send, X, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { useEnsureMiraiConversation } from "../hooks/useMirAI";
import { useChatMessages, useSendMessage } from "../hooks/useChatMessages";
import { useChatPresence } from "../hooks/useChatPresence";
import { MiraiProposalCard } from "./MiraiProposalCard";
import { MIRAI_NAME, MIRAI_TYPING_SENTINEL } from "../lib/mirai";
import { buildMiraiPageContext, useCurrentMiraiRecord } from "../lib/miraiPageContext";

const EXAMPLE_PROMPTS = [
  "Qué huecos libres tengo mañana",
  "Cuántas horas de reuniones tuve esta semana",
  "Agenda una reunión mañana a las 10",
];

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
  const { typingUsersList } = useChatPresence(conversationId);
  const miraiTyping = typingUsersList.includes(MIRAI_TYPING_SENTINEL);

  const messages = data?.data ?? [];
  const [draft, setDraft] = useState("");
  const listEndRef = useRef(null);

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, miraiTyping]);

  function openInChat() {
    if (!conversationId) return;
    navigate(`/app/m/runly.chat/chat/inbox/${conversationId}`);
    onClose?.();
  }

  async function submit(text) {
    const body = (text ?? draft).trim();
    if (!body || send.isPending || !conversationId) return;
    setDraft("");
    const pageContext = buildMiraiPageContext(location.pathname, currentRecord);
    try {
      await send.mutateAsync({ body, metadata: pageContext ? { miraiPageContext: pageContext } : undefined });
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
        <div className="flex items-end gap-2">
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
            disabled={!draft.trim() || send.isPending || !conversationId}
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
