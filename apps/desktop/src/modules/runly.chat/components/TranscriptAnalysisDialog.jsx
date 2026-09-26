import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  Button, Skeleton, ErrorState, ComboboxField, SelectField, Checkbox,
} from "@runly/ui";
import { Copy, Check } from "lucide-react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../../auth/AuthProvider";
import { runly } from "../../../lib/runly";
import { useAnalyzeTranscript, useCommitTranscriptProposals } from "../hooks/useConversationTranscripts";
import { analysisToPlainText, copyTextToClipboard } from "../lib/transcriptAnalysisExport";
import { TYPE_OPTIONS as CONTACT_TYPE_OPTIONS } from "../../runly.contacts/constants";

const CONTACTS_MODULE_KEY = "runly.contacts";

function unwrap(r) { return r?.data ?? r; }

// Small "Copiar" -> "Copiado" toggle, same micro-interaction as chatRichText's
// CodeBlock copy button — used for both the summary-only copy and the
// copy-everything action below.
function CopyButton({ text, label = "Copiar" }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-7 gap-1.5 px-2 text-xs text-[hsl(var(--muted-foreground))]"
      onClick={async () => {
        try {
          await copyTextToClipboard(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch (err) {
          toast.error(err?.message ?? "No se pudo copiar.");
        }
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copiado" : label}
    </Button>
  );
}

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
  // Contacts (and any future module proposal type) need an explicit
  // accept/reject signal distinct from the type picker: unlike a task's
  // "empty project = not accepted", a contact always has a suggested type
  // pre-filled, so a bare SelectField can't double as the acceptance signal.
  const [contactAccepted, setContactAccepted] = useState({}); // { [index]: boolean }
  const [contactTypes, setContactTypes] = useState({}); // { [index]: type override }

  const analysis = unwrap(analyze.data)?.analysis ?? unwrap(commit.data)?.analysis;
  const proofToken = unwrap(analyze.data)?.proofToken;
  const proposedContacts = analysis?.moduleProposals?.[CONTACTS_MODULE_KEY]?.proposed ?? [];

  // Picking a project/calendar per item, one at a time, was the friction the
  // user flagged directly — these two apply one choice to every item at once.
  // Still fully overridable per item below; this only sets a starting point.
  function applyProjectToAll(projectId) {
    if (!projectId || !analysis?.actionItems?.length) return;
    setTaskProjects(Object.fromEntries(analysis.actionItems.map((_, index) => [index, projectId])));
  }
  function applyCalendarToAll(calendarId) {
    if (!calendarId || !analysis?.proposedEvents?.length) return;
    setEventCalendars(Object.fromEntries(analysis.proposedEvents.map((_, index) => [index, calendarId])));
  }

  async function handleAnalyze() {
    // A re-analyze fully replaces actionItems/proposedEvents (different
    // length/order/content) — any project/calendar already picked by index
    // must not silently carry over to whatever new item lands on that same
    // index (code review finding: this previously misassigned a stale
    // selection to an unrelated re-analyzed item).
    setTaskProjects({});
    setEventCalendars({});
    setContactAccepted({});
    setContactTypes({});
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
    const acceptedModuleProposals = Object.entries(contactAccepted)
      .filter(([, accepted]) => accepted)
      .map(([index]) => ({
        moduleKey: CONTACTS_MODULE_KEY,
        index: Number(index),
        decision: { type: contactTypes[index] ?? proposedContacts[Number(index)]?.suggestedType },
      }));
    if (!acceptedActionItems.length && !acceptedEvents.length && !acceptedModuleProposals.length) {
      toast.error("Elige al menos una propuesta para confirmar.");
      return;
    }
    try {
      const result = await commit.mutateAsync({ transcriptId, proofToken, acceptedActionItems, acceptedEvents, acceptedModuleProposals });
      const { createdTasks, createdEvents, createdModuleRecords, skippedActionItems, skippedEvents, skippedModuleProposals } = unwrap(result);
      const createdContacts = createdModuleRecords?.filter((r) => r.moduleKey === CONTACTS_MODULE_KEY) ?? [];
      toast.success(`Creadas ${createdTasks.length} tarea(s), ${createdEvents.length} evento(s) y ${createdContacts.length} contacto(s).`);
      const skippedCount = (skippedActionItems?.length ?? 0) + (skippedEvents?.length ?? 0) + (skippedModuleProposals?.length ?? 0);
      if (skippedCount > 0) {
        toast.warning(`${skippedCount} propuesta(s) no se pudieron confirmar.`);
      }
      setTaskProjects({});
      setEventCalendars({});
      setContactAccepted({});
      setContactTypes({});
    } catch (err) {
      toast.error(err?.message ?? "No se pudo confirmar las propuestas.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <DialogTitle>Análisis de MirAI</DialogTitle>
            <DialogDescription>
              Resumen, acuerdos y tareas/eventos propuestos a partir de la transcripción.
            </DialogDescription>
          </div>
          {analysis && <CopyButton text={analysisToPlainText(analysis)} label="Copiar todo" />}
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
          <div className="flex flex-col gap-3">
          <div className="flex max-h-[55vh] flex-col gap-4 overflow-y-auto pr-1">
            <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/40 p-3">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <h3 className="text-sm font-medium">Resumen</h3>
                <CopyButton text={analysis.summary} />
              </div>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-[hsl(var(--foreground))]">
                {analysis.summary}
              </p>
            </div>

            {analysis.decisions?.length > 0 && (
              <div className="rounded-lg border border-[hsl(var(--border))] p-3">
                <h3 className="mb-1.5 text-sm font-medium">Acuerdos</h3>
                <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed">
                  {analysis.decisions.map((d, i) => <li key={i}>{d}</li>)}
                </ul>
              </div>
            )}

            {analysis.actionItems?.length > 0 && (
              <div className="rounded-lg border border-[hsl(var(--border))] p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-medium">Tareas propuestas</h3>
                  {/* Applies one project to every item at once — still
                      overridable per item below. The friction of picking one
                      by one, every single time, was flagged directly. */}
                  {analysis.actionItems.length > 1 && (
                    <ComboboxField
                      className="w-48"
                      placeholder="Proyecto para todas..."
                      options={projectOptions}
                      value=""
                      onChange={applyProjectToAll}
                    />
                  )}
                </div>
                <div className="flex flex-col gap-2">
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
              <div className="rounded-lg border border-[hsl(var(--border))] p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-medium">Eventos propuestos</h3>
                  {analysis.proposedEvents.length > 1 && (
                    <ComboboxField
                      className="w-48"
                      placeholder="Calendario para todos..."
                      options={calendarOptions}
                      value=""
                      onChange={applyCalendarToAll}
                    />
                  )}
                </div>
                <div className="flex flex-col gap-2">
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

            {proposedContacts.length > 0 && (
              <div className="rounded-lg border border-[hsl(var(--border))] p-3">
                <h3 className="mb-2 text-sm font-medium">Contactos propuestos</h3>
                <div className="flex flex-col gap-2">
                  {proposedContacts.map((contact, index) => (
                    <div key={index} className="flex items-start gap-2">
                      <Checkbox
                        className="mt-1"
                        checked={Boolean(contactAccepted[index])}
                        onCheckedChange={(checked) => setContactAccepted((prev) => ({ ...prev, [index]: Boolean(checked) }))}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5 text-sm">
                          <span className="font-medium">{contact.name}</span>
                          <span
                            className={[
                              "rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                              contact.matchedContactId
                                ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                                : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
                            ].join(" ")}
                          >
                            {contact.matchedContactId ? "Actualizar" : "Nuevo"}
                          </span>
                        </div>
                        {(contact.email || contact.phone || contact.company) && (
                          <p className="text-xs text-[hsl(var(--muted-foreground))]">
                            {[contact.company, contact.email, contact.phone].filter(Boolean).join(" · ")}
                          </p>
                        )}
                      </div>
                      <SelectField
                        className="w-40"
                        options={CONTACT_TYPE_OPTIONS}
                        value={contactTypes[index] ?? contact.suggestedType}
                        onChange={(value) => setContactTypes((prev) => ({ ...prev, [index]: value }))}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

            <div className="flex justify-end gap-2 border-t border-[hsl(var(--border))] pt-3">
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
