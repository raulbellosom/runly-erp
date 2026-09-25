import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  Button, Skeleton, ErrorState, ComboboxField, Textarea,
} from "@runly/ui";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../../auth/AuthProvider";
import { runly } from "../../../lib/runly";
import { useAnalyzeTranscript, useCommitTranscriptProposals } from "../hooks/useConversationTranscripts";

function unwrap(r) { return r?.data ?? r; }

// Gated on `open` (not just having a token): this dialog is mounted as a
// permanent sibling inside TranscriptViewerDialog (see that file), so without
// this gate every transcript view would fire both list requests regardless
// of whether the user ever clicks "Analizar con MirAI".
function useProjectOptions(open) {
  const { session } = useAuth();
  const { data } = useQuery({
    queryKey: ["chat-transcript-analysis-projects"],
    enabled: Boolean(open && session?.access_token),
    queryFn: () => runly.projects.listProjects(session.access_token),
  });
  return (unwrap(data) ?? []).map((p) => ({ value: p.id, label: p.name }));
}

function useCalendarOptions(open) {
  const { session } = useAuth();
  const { data } = useQuery({
    queryKey: ["chat-transcript-analysis-calendars"],
    enabled: Boolean(open && session?.access_token),
    queryFn: () => runly.calendar.listCalendars(session.access_token),
  });
  // listCalendars resolves to { owned, shared }, not a flat array (same
  // shape consumed via calData?.owned/shared in useCalendarData.js callers) —
  // treating it as an array here threw "(... ?? []).map is not a function".
  const calendars = unwrap(data);
  return [...(calendars?.owned ?? []), ...(calendars?.shared ?? [])].map((c) => ({ value: c.id, label: c.name }));
}

// transcriptId only (no conversationId prop): useAnalyzeTranscript/
// useCommitTranscriptProposals both accept a conversationId argument, but
// neither hook body actually uses it today (see
// apps/desktop/src/modules/runly.chat/hooks/useConversationTranscripts.js) —
// invalidation keys off transcriptId. This dialog is opened purely from a
// transcript, so there's nothing to gain from threading conversationId
// through as well.
export function TranscriptAnalysisDialog({ transcriptId, open, onOpenChange }) {
  const analyze = useAnalyzeTranscript();
  const commit = useCommitTranscriptProposals();
  const projectOptions = useProjectOptions(open);
  const calendarOptions = useCalendarOptions(open);
  const [taskProjects, setTaskProjects] = useState({}); // { [index]: projectId }
  const [eventCalendars, setEventCalendars] = useState({}); // { [index]: calendarId }

  const analysis = unwrap(analyze.data)?.analysis ?? unwrap(commit.data)?.analysis;
  const proofToken = unwrap(analyze.data)?.proofToken;

  async function handleAnalyze() {
    // A re-analyze fully replaces actionItems/proposedEvents (different
    // length/order/content) — any project/calendar already picked by index
    // must not silently carry over to whatever new item lands on that same
    // index (code review finding: this previously misassigned a stale
    // selection to an unrelated re-analyzed item).
    setTaskProjects({});
    setEventCalendars({});
    try {
      await analyze.mutateAsync(transcriptId);
    } catch (err) {
      toast.error(err?.message ?? "No se pudo analizar la transcripción.");
    }
  }

  async function handleCommit() {
    const acceptedActionItems = Object.entries(taskProjects)
      .filter(([, projectId]) => projectId)
      .map(([index, projectId]) => ({ index: Number(index), projectId }));
    const acceptedEvents = Object.entries(eventCalendars)
      .filter(([, calendarId]) => calendarId)
      .map(([index, calendarId]) => ({ index: Number(index), calendarId }));
    if (!acceptedActionItems.length && !acceptedEvents.length) {
      toast.error("Elige al menos una tarea o evento para confirmar.");
      return;
    }
    try {
      const result = await commit.mutateAsync({ transcriptId, proofToken, acceptedActionItems, acceptedEvents });
      const { createdTasks, createdEvents, skippedActionItems, skippedEvents } = unwrap(result);
      toast.success(`Creadas ${createdTasks.length} tarea(s) y ${createdEvents.length} evento(s).`);
      if (skippedActionItems?.length || skippedEvents?.length) {
        toast.warning(`${(skippedActionItems?.length ?? 0) + (skippedEvents?.length ?? 0)} propuesta(s) no se pudieron confirmar.`);
      }
      setTaskProjects({});
      setEventCalendars({});
    } catch (err) {
      toast.error(err?.message ?? "No se pudo confirmar las propuestas.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Análisis de MirAI</DialogTitle>
          <DialogDescription>
            Resumen, acuerdos y tareas/eventos propuestos a partir de la transcripción.
          </DialogDescription>
        </DialogHeader>

        {!analysis && (
          <div className="flex flex-col items-center gap-3 py-6">
            <Button onClick={handleAnalyze} disabled={analyze.isPending}>
              {analyze.isPending ? "Analizando..." : "Analizar con MirAI"}
            </Button>
          </div>
        )}

        {analyze.isPending && <Skeleton className="h-24 w-full" />}
        {analyze.isError && (
          <ErrorState
            title="No se pudo analizar la transcripción."
            description={analyze.error?.message}
            onRetry={handleAnalyze}
          />
        )}

        {analysis && (
          <div className="flex flex-col gap-4">
            <div>
              <h3 className="text-sm font-medium">Resumen</h3>
              <Textarea readOnly value={analysis.summary} className="mt-1 resize-none" rows={3} />
            </div>

            {analysis.decisions?.length > 0 && (
              <div>
                <h3 className="text-sm font-medium">Acuerdos</h3>
                <ul className="mt-1 list-disc pl-5 text-sm">
                  {analysis.decisions.map((d, i) => <li key={i}>{d}</li>)}
                </ul>
              </div>
            )}

            {analysis.actionItems?.length > 0 && (
              <div>
                <h3 className="text-sm font-medium">Tareas propuestas</h3>
                <div className="mt-1 flex flex-col gap-2">
                  {analysis.actionItems.map((item, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 text-sm">{item.text}</span>
                      <ComboboxField
                        className="w-48"
                        placeholder="Elegir proyecto..."
                        options={projectOptions}
                        value={taskProjects[index] ?? ""}
                        onChange={(value) => setTaskProjects((prev) => ({ ...prev, [index]: value }))}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {analysis.proposedEvents?.length > 0 && (
              <div>
                <h3 className="text-sm font-medium">Eventos propuestos</h3>
                <div className="mt-1 flex flex-col gap-2">
                  {analysis.proposedEvents.map((ev, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 text-sm">
                        {ev.title} — {new Date(ev.startsAt).toLocaleString("es-MX")}
                      </span>
                      <ComboboxField
                        className="w-48"
                        placeholder="Elegir calendario..."
                        options={calendarOptions}
                        value={eventCalendars[index] ?? ""}
                        onChange={(value) => setEventCalendars((prev) => ({ ...prev, [index]: value }))}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={handleAnalyze} disabled={analyze.isPending}>
                Analizar de nuevo
              </Button>
              <Button onClick={handleCommit} disabled={commit.isPending}>
                {commit.isPending ? "Confirmando..." : "Confirmar seleccionadas"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
