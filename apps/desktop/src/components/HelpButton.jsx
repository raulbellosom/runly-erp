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
  EmptyState,
  MarkdownViewer,
  Textarea,
  Button,
} from "@runly/ui";
import { runly } from "../lib/runly";
import { useAuth } from "../auth/AuthProvider";
import { toApiPath } from "../lib/apiPath.js";

const MAX_HISTORY_TURNS = 6;

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

  const askMutation = useMutation({
    mutationFn: () => {
      const history = conversation
        .slice(-MAX_HISTORY_TURNS)
        .map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));
      return runly.help.askAssistant({ path: apiPath, question: draft.trim(), history }, token).then((r) => r.data);
    },
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

  function handleAsk() {
    const question = draft.trim();
    if (!question || askMutation.isPending) return;
    setConversation((prev) => [...prev, { role: "user", content: question }]);
    setDraft("");
    askMutation.mutate();
  }

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
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto flex flex-col">
          <SheetHeader>
            <SheetTitle>Ayuda</SheetTitle>
            <SheetDescription>
              {data?.moduleName ? `Ayuda de ${data.moduleName}` : "Ayuda del sistema"}
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-6">
            {isLoading && (
              <p className="text-sm text-[hsl(var(--muted-foreground))]">Cargando...</p>
            )}
            {!isLoading && !data?.view && !data?.overview && (
              <EmptyState
                title="Aun no hay ayuda para este modulo"
                description="Estamos escribiendo la documentacion de esta seccion."
              />
            )}
            {data?.view && (
              <div>
                <h3 className="text-sm font-semibold mb-1">{data.view.title}</h3>
                <MarkdownViewer value={data.view.content} />
              </div>
            )}
            {data?.overview && (
              <div>
                <h3 className="text-sm font-semibold mb-1">{data.overview.title}</h3>
                <MarkdownViewer value={data.overview.content} />
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              navigate("/app/help");
            }}
            className="mt-6 text-xs text-[hsl(var(--primary))] hover:underline"
          >
            Ver toda la documentacion
          </button>

          <div className="mt-6 border-t border-[hsl(var(--border))] pt-4 flex-1 flex flex-col min-h-0">
            <h3 className="text-sm font-semibold mb-2">Preguntar</h3>
            <div className="flex-1 min-h-0 overflow-y-auto space-y-3 mb-3">
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
                        <p className="text-xs text-[hsl(var(--muted-foreground))]">Resultados de busqueda:</p>
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
            <div className="flex items-end gap-2">
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleAsk();
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
                onClick={handleAsk}
                disabled={askMutation.isPending || !draft.trim()}
                aria-label="Enviar pregunta"
              >
                <Send size={16} />
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
