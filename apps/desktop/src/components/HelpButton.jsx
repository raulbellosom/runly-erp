import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CircleHelp, Send } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
  Textarea,
  Button,
} from "@runly/ui";
import { runly } from "../lib/runly";
import { useAuth } from "../auth/AuthProvider";
import { toApiPath } from "../lib/apiPath.js";

const MAX_HISTORY_TURNS = 6;

function SuggestionChip({ label, onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={() => onClick(label)}
      disabled={disabled}
      className="rounded-full border border-[hsl(var(--border))] px-3 py-1.5 text-xs text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {label}
    </button>
  );
}

export function HelpButton() {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [conversation, setConversation] = useState([]); // { role, content, sources? }[]
  const { session } = useAuth();
  const token = session?.access_token;
  const location = useLocation();
  const navigate = useNavigate();
  const apiPath = toApiPath(location.pathname);

  const { data, isLoading } = useQuery({
    queryKey: ["help", "resolve", apiPath],
    queryFn: () => runly.help.resolveHelp(apiPath, token).then((r) => r.data),
    enabled: Boolean(token) && open,
  });

  // mutationFn takes { question, history } as explicit mutate() variables
  // rather than reading draft/conversation from the closure — useMutation
  // re-binds mutationFn to each render's options, so a closure read can
  // observe post-clear state (draft === "") if a re-render (triggered by
  // setDraft("") right before mutate()) lands before the mutation's async
  // dispatch actually runs, sending an empty question and failing the
  // server's min-length validation ("Cuerpo invalido").
  const askMutation = useMutation({
    mutationFn: ({ question, history }) =>
      runly.help.askAssistant({ path: apiPath, question, history }, token).then((r) => r.data),
    onSuccess: (result) => {
      if (result.mode === "ai") {
        setConversation((prev) => [...prev, { role: "assistant", content: result.answer, sources: result.sources }]);
      } else {
        setConversation((prev) => [...prev, { role: "assistant", content: "", results: result.results }]);
      }
    },
    onError: (err) => {
      setConversation((prev) => [...prev, { role: "error", content: err?.message || "El asistente no pudo responder." }]);
    },
  });

  function sendQuestion(text) {
    const question = text.trim();
    if (!question || askMutation.isPending) return;
    const history = conversation
      .slice(-MAX_HISTORY_TURNS)
      .map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));
    setConversation((prev) => [...prev, { role: "user", content: question }]);
    setDraft("");
    askMutation.mutate({ question, history });
  }

  const contextTitle = data?.view?.title ?? data?.overview?.title ?? null;
  const welcomeSummary = data?.view?.summary ?? data?.overview?.summary ?? null;
  const suggestions = [
    "¿Qué puedo hacer aquí?",
    "¿Cómo empiezo?",
    ...(contextTitle ? [`Cuéntame más sobre ${contextTitle}`] : []),
  ];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Ayuda"
        title="Ayuda"
        className="h-9 w-9 flex items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors duration-150 cursor-pointer"
      >
        <CircleHelp size={16} />
      </button>
      {/* overflow-hidden overrides the mobile bottom-sheet surface's own
          overflow-y-auto (via twMerge) — without this, on mobile the whole
          panel (including the drag handle above these children) scrolls as
          one unit and the header/composer/handle all disappear together
          when the conversation grows. Header and footer below stay outside
          the only scrollable region (the middle div). */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-hidden">
          <SheetHeader className="shrink-0">
            <SheetTitle>Ayuda</SheetTitle>
            <SheetDescription>
              {data?.moduleName ? `Ayuda de ${data.moduleName}` : "Ayuda del sistema"}
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 min-h-0 overflow-y-auto space-y-3">
            {isLoading && (
              <p className="text-sm text-[hsl(var(--muted-foreground))]">Cargando...</p>
            )}

            {!isLoading && conversation.length === 0 && (
              <div className="space-y-3">
                <div className="max-w-[95%] rounded-2xl px-3 py-2 text-sm bg-[hsl(var(--muted))] text-[hsl(var(--foreground))]">
                  {welcomeSummary
                    ? welcomeSummary
                    : "Aún no hemos escrito documentación específica para esta pantalla, pero puedes preguntarme lo que necesites."}
                </div>
                <div className="flex flex-wrap gap-2">
                  {suggestions.map((s) => (
                    <SuggestionChip key={s} label={s} onClick={sendQuestion} disabled={askMutation.isPending} />
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    navigate("/app/help");
                  }}
                  className="text-xs text-[hsl(var(--primary))] hover:underline"
                >
                  Ver toda la documentación
                </button>
              </div>
            )}

            {conversation.map((m, i) => {
              if (m.role === "user") {
                return (
                  <div key={i} className="flex justify-end">
                    <div className="max-w-[85%] rounded-2xl px-3 py-2 text-sm bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]">
                      {m.content}
                    </div>
                  </div>
                );
              }
              if (m.role === "error") {
                return (
                  <div key={i} className="rounded-2xl px-3 py-2 text-sm bg-red-500/10 text-red-600 dark:text-red-400">
                    {m.content}
                  </div>
                );
              }
              // assistant
              return (
                <div key={i} className="max-w-[95%] rounded-2xl px-3 py-2 text-sm bg-[hsl(var(--muted))] text-[hsl(var(--foreground))]">
                  {m.content && <p className="whitespace-pre-wrap">{m.content}</p>}
                  {m.sources?.length > 0 && (
                    <div className="mt-2 space-y-0.5">
                      <p className="text-xs text-[hsl(var(--muted-foreground))]">Fuentes:</p>
                      {m.sources.map((s, j) => (
                        <p key={j} className="text-xs text-[hsl(var(--muted-foreground))]">
                          {s.moduleName}{s.title ? ` · ${s.title}` : ""}
                        </p>
                      ))}
                    </div>
                  )}
                  {m.results && (
                    <div className="space-y-2">
                      <p className="text-xs text-[hsl(var(--muted-foreground))]">Resultados de búsqueda:</p>
                      {m.results.length === 0 && (
                        <p className="text-xs text-[hsl(var(--muted-foreground))]">Sin resultados.</p>
                      )}
                      {m.results.map((r, j) => (
                        <div key={j} className="rounded-lg border border-[hsl(var(--border))] p-2">
                          <p className="text-xs font-medium">{r.moduleName} · {r.title}</p>
                          <p className="text-xs text-[hsl(var(--muted-foreground))]">{r.snippet}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {askMutation.isPending && (
              <p className="text-sm text-[hsl(var(--muted-foreground))]">Pensando...</p>
            )}
          </div>

          <SheetFooter className="shrink-0 mt-0 flex-row items-end gap-2 border-t border-[hsl(var(--border))] pt-4">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendQuestion(draft);
                }
              }}
              placeholder="Escribe tu pregunta..."
              rows={2}
              disabled={askMutation.isPending}
              className="flex-1"
            />
            <Button
              type="button"
              size="icon"
              onClick={() => sendQuestion(draft)}
              disabled={askMutation.isPending || !draft.trim()}
              aria-label="Enviar pregunta"
            >
              <Send size={16} />
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
