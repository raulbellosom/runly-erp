// apps/desktop/src/modules/runly.chat/components/MirAIPanel.jsx
import { useEffect, useRef, useState } from "react";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
  Button, EmptyState, Skeleton, ConfirmDialog, Textarea, AssistantWordmark, renderRichText,
} from "@runly/ui";
import { Sparkles, Send, Trash2, Volume2, Square, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useChatPreferences, chatPreferencesStyle } from "../hooks/useChatPreferences";
import { useMiraiStatus } from "../hooks/useMirAI";
import { useTtsStatus, useSpeakText } from "../hooks/useTextToSpeech";
import { useMiraiPanelThread, useSendMiraiPanel, useClearMiraiPanel } from "../hooks/useMirAIPanel";
import { MIRAI_NAME } from "../lib/mirai";
import "../chat-theme.css";

const FOCUS_PROMPT = "¿Qué me puedes decir de este mensaje?";

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

function Bubble({ role, content, ttsEnabled, speech }) {
  const isUser = role === "user";
  const playing = !isUser && speech?.isPlaying(content);
  const loading = !isUser && speech?.isLoading(content);

  async function handleSpeak() {
    try {
      await speech.speak(content);
    } catch (err) {
      toast.error(err?.message ?? "No se pudo generar el audio.");
    }
  }

  return (
    <div className={["group/bubble flex gap-2", isUser ? "justify-end" : "justify-start"].join(" ")}>
      {!isUser && <BotAvatar />}
      <div
        className={[
          // min-w-0: this bubble is a flex-row item — without it, a long
          // unbroken run of characters floors its width at min-content and
          // overflows past max-w-[80%] regardless of wrap-break-word (see
          // the matching note in ChatMessageBubble.jsx).
          "min-w-0 max-w-[80%] wrap-break-word rounded-2xl px-3 py-2 text-sm",
          isUser
            ? "whitespace-pre-wrap bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
            : "bg-[hsl(var(--muted))] text-[hsl(var(--foreground))]",
        ].join(" ")}
      >
        {renderRichText(content, { paragraphClassName: isUser ? "whitespace-pre-wrap wrap-break-word" : "text-left whitespace-pre-wrap wrap-break-word" })}
      </div>
      {!isUser && ttsEnabled && (
        <button
          type="button"
          onClick={handleSpeak}
          title={playing ? "Detener" : "Leer en voz alta"}
          className="flex h-7 w-7 shrink-0 items-center justify-center self-center rounded-full text-[hsl(var(--muted-foreground))] opacity-0 transition hover:bg-[hsl(var(--primary)/0.1)] hover:text-[hsl(var(--primary))] group-hover/bubble:opacity-100 focus-visible:opacity-100"
        >
          {loading
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
            : playing
              ? <Square className="h-3.5 w-3.5" />
              : <Volume2 className="h-3.5 w-3.5" />}
        </button>
      )}
    </div>
  );
}

export function MirAIPanel({ open, onOpenChange, conversationId, focusMessage }) {
  const { prefs } = useChatPreferences();
  const { data: status } = useMiraiStatus();
  const available = status?.available !== false;
  const { data: ttsStatus } = useTtsStatus();
  const ttsEnabled = Boolean(ttsStatus?.enabled);
  const speech = useSpeakText();

  const { data, isLoading } = useMiraiPanelThread(conversationId, { enabled: open });
  const send = useSendMiraiPanel(conversationId);
  const clear = useClearMiraiPanel(conversationId);

  const [draft, setDraft] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const pendingFocusId = useRef(null);
  const listEndRef = useRef(null);

  const messages = data?.messages ?? [];

  // When opened from a message action, prefill the composer and remember which
  // message to attach as focus on the FIRST send of this session.
  useEffect(() => {
    if (!open) return;
    if (focusMessage?.id) {
      pendingFocusId.current = focusMessage.id;
      setDraft((d) => (d.trim() ? d : FOCUS_PROMPT));
    }
  }, [open, focusMessage?.id]);

  useEffect(() => {
    if (!open) { setDraft(""); pendingFocusId.current = null; speech.stop(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, send.isPending]);

  function submit() {
    const content = draft.trim();
    if (!content || send.isPending || !available) return;
    const focusMessageId = pendingFocusId.current;
    pendingFocusId.current = null;
    setDraft("");
    send.mutate({ content, focusMessageId });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="chat-glass-theme chat-glass flex w-full flex-col sm:max-w-[380px]"
        style={chatPreferencesStyle(prefs)}
      >
        <SheetHeader>
          <SheetTitle className="chat-font-display flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[hsl(var(--primary))]" />
            <AssistantWordmark />
            <span className="text-xs font-normal text-[hsl(var(--muted-foreground))]">· solo tú ves esto</span>
          </SheetTitle>
        </SheetHeader>

        <div className="flex items-center justify-end pb-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs text-[hsl(var(--muted-foreground))]"
            disabled={!messages.length || clear.isPending}
            onClick={() => setConfirmClear(true)}
          >
            <Trash2 className="mr-1 h-3.5 w-3.5" />
            Limpiar
          </Button>
        </div>

        <div className="flex-1 min-h-0 space-y-3 overflow-y-auto py-2">
          {isLoading && (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-3/4 rounded-2xl" />)}
            </div>
          )}

          {!isLoading && !messages.length && !send.isPending && (
            <EmptyState
              icon={Sparkles}
              title="Pregúntame sobre esta conversación"
              description="Puedo resumirla, explicarte un mensaje o un archivo, y responder preguntas generales."
            />
          )}

          {messages.map((m, i) => (
            <Bubble key={m.createdAt ?? i} role={m.role} content={m.content} ttsEnabled={ttsEnabled} speech={speech} />
          ))}

          {send.isPending && (
            <div className="flex items-center gap-2 px-1">
              <BotAvatar />
              <div className="flex gap-0.5">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-[hsl(var(--muted-foreground))]"
                    style={{ animationDelay: `${i * 0.15}s` }}
                  />
                ))}
              </div>
              <span className="text-xs italic text-[hsl(var(--muted-foreground))]">{MIRAI_NAME} está pensando</span>
            </div>
          )}

          {send.isError && (
            <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-500">
              No se pudo obtener respuesta. Intenta de nuevo.
            </p>
          )}

          <div ref={listEndRef} />
        </div>

        <div className="border-t border-[hsl(var(--border))] pt-2">
          <div className="flex items-end gap-2">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
              }}
              rows={2}
              disabled={!available || send.isPending}
              placeholder={available ? `Escribe a ${MIRAI_NAME}...` : `${MIRAI_NAME} no está configurado`}
              className="min-h-[44px] flex-1 resize-none"
            />
            <Button size="icon" className="h-9 w-9 shrink-0" disabled={!draft.trim() || send.isPending || !available} onClick={submit}>
              <Send className="h-4 w-4" />
            </Button>
          </div>
          <p className="mt-1 text-[10px] text-[hsl(var(--muted-foreground))]">Enter para enviar · Shift+Enter para nueva línea</p>
        </div>

        <ConfirmDialog
          open={confirmClear}
          onOpenChange={setConfirmClear}
          title="Limpiar la conversación con MirAI"
          description="Se borrará todo lo que has hablado con MirAI sobre este chat. Esta acción no se puede deshacer."
          confirmLabel="Limpiar"
          variant="destructive"
          onConfirm={() => { clear.mutate(); setConfirmClear(false); }}
        />
      </SheetContent>
    </Sheet>
  );
}
