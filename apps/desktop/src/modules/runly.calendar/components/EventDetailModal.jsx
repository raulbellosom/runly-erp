import { useState } from "react";
import {
  MapPin,
  Video,
  Calendar,
  Clock,
  Users,
  Repeat,
  Edit2,
  Trash2,
  BellRing,
} from "lucide-react";
import { useDeleteEvent } from "../hooks/useCalendarData";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  MarkdownViewer,
  ConfirmDialog,
  Skeleton,
  Button,
} from "@runly/ui";
import {
  formatReminderClock,
  formatReminderLead,
  getPrimaryReminderMinutes,
} from "../lib/reminder-utils";
import { useCalls } from "../../runly.chat/calls/CallsProvider";

const STATUS_LABELS = {
  PENDING: "Pendiente",
  ACCEPTED: "Aceptado",
  DECLINED: "Rechazado",
};

export default function EventDetailModal({
  event,
  onClose,
  onEdit,
  canEdit,
  canDelete,
}) {
  const deleteEvent = useDeleteEvent();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { enabled: callsEnabled, isStarting: callPending, startCall } = useCalls();

  if (!event) return null;

  if (event._isLoading) {
    return (
      <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
        <DialogContent size="lg" className="px-0 pt-0 pb-0 md:p-0 gap-0 overflow-hidden">
          <DialogTitle className="sr-only">Cargando evento</DialogTitle>
          <div className="h-1.5 bg-[hsl(var(--muted))]" />
          <div className="px-5 pt-4 pb-5 space-y-3">
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const calColor = event.color || event.calendar?.color || "#6B46C1";
  const reminderMinutes = getPrimaryReminderMinutes(event);
  const reminderClock = formatReminderClock(event, reminderMinutes);
  const isChatMeeting = event.sourceModule === "runly.chat" && Boolean(event.sourceEntityId);
  const deleteTitle = event._isRecurrenceInstance
    ? "Eliminar serie"
    : "Eliminar evento";
  const deleteDescription = event._isRecurrenceInstance
    ? "¿Eliminar todos los eventos de esta serie?"
    : "¿Eliminar este evento?";

  async function doDelete() {
    try {
      await deleteEvent.mutateAsync(event._baseEventId ?? event.id);
      toast.success("Evento eliminado");
      setConfirmOpen(false);
      onClose();
    } catch (err) {
      toast.error(err.message || "Error al eliminar el evento");
    }
  }

  return (
    <>
      <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
        <DialogContent
          size="lg"
          scrollable
          className="px-0 pt-0 pb-0 md:p-0 gap-0 overflow-hidden max-h-[85dvh] md:max-h-[85dvh]"
        >
          <div className="h-1.5 shrink-0" style={{ backgroundColor: calColor }} />

          <DialogHeader className="shrink-0 mb-0 space-y-0 px-5 pt-3 pb-3 pr-12">
            <div className="flex items-center justify-end gap-1 -mt-1 -mr-1">
              {canEdit && (
                <button
                  onClick={() => onEdit(event)}
                  className="p-1.5 rounded hover:bg-[hsl(var(--muted))]"
                  title={event._isRecurrenceInstance ? "Editar serie" : "Editar"}
                >
                  <Edit2
                    size={15}
                    className="text-[hsl(var(--muted-foreground))]"
                  />
                </button>
              )}
              {canDelete && !event.sourceModule && (
                <button
                  onClick={() => setConfirmOpen(true)}
                  disabled={deleteEvent.isPending}
                  className="p-1.5 rounded hover:bg-[hsl(var(--muted))]"
                  title={
                    event._isRecurrenceInstance ? "Eliminar serie" : "Eliminar"
                  }
                >
                  <Trash2
                    size={15}
                    className="text-[hsl(var(--muted-foreground))]"
                  />
                </button>
              )}
            </div>
            <DialogTitle className="text-lg font-semibold leading-tight">
              {event.title}
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 pb-5 space-y-3">
            {isChatMeeting && callsEnabled && (
              <Button
                type="button"
                className="w-full"
                disabled={callPending}
                onClick={() => startCall({
                  conversationId: event.sourceEntityId,
                  calendarEventId: event._baseEventId ?? event.id,
                  kind: "VIDEO",
                })}
              >
                <Video className="mr-2 h-4 w-4" />
                Iniciar llamada
              </Button>
            )}

            {event.description && (
              <MarkdownViewer
                value={event.description}
                accentColor={calColor}
              />
            )}

            <div className="space-y-2.5">
              <div className="flex items-start gap-2.5">
                <Clock
                  size={14}
                  className="text-[hsl(var(--muted-foreground))] mt-0.5 shrink-0"
                />
                <div className="text-sm text-[hsl(var(--foreground))]">
                  {event.allDay ? (
                    new Date(event.startAt).toLocaleDateString("es-MX", {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })
                  ) : (
                    <>
                      <div>
                        {new Date(event.startAt).toLocaleDateString("es-MX", {
                          weekday: "long",
                          day: "numeric",
                          month: "long",
                          year: "numeric",
                        })}
                      </div>
                      <div className="text-[hsl(var(--muted-foreground))] text-xs mt-0.5">
                        {new Date(event.startAt).toLocaleTimeString("es-MX", {
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: false,
                        })}
                        {event.endAt &&
                          ` – ${new Date(event.endAt).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", hour12: false })}`}
                      </div>
                    </>
                  )}
                </div>
              </div>

              {event.location && (
                <div className="flex items-center gap-2.5">
                  <MapPin
                    size={14}
                    className="text-[hsl(var(--muted-foreground))] shrink-0"
                  />
                  <span className="text-sm text-[hsl(var(--foreground))]">
                    {event.location}
                  </span>
                </div>
              )}

              {event.videoUrl && (
                <div className="flex items-center gap-2.5">
                  <Video
                    size={14}
                    className="text-[hsl(var(--muted-foreground))] shrink-0"
                  />
                  <a
                    href={event.videoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-violet-500 hover:underline truncate"
                  >
                    Unirse a la videollamada
                  </a>
                </div>
              )}

              {event.calendar && (
                <div className="flex items-center gap-2.5">
                  <Calendar
                    size={14}
                    className="text-[hsl(var(--muted-foreground))] shrink-0"
                  />
                  <span className="text-sm text-[hsl(var(--foreground))]">
                    {event.calendar.name}
                  </span>
                </div>
              )}

              {event.recurrenceRule && (
                <div className="flex items-center gap-2.5">
                  <Repeat
                    size={14}
                    className="text-[hsl(var(--muted-foreground))] shrink-0"
                  />
                  <span className="text-sm text-[hsl(var(--muted-foreground))]">
                    {event.recurrenceRule.freq === "DAILY" &&
                      "Se repite diariamente"}
                    {event.recurrenceRule.freq === "WEEKLY" &&
                      "Se repite semanalmente"}
                    {event.recurrenceRule.freq === "MONTHLY" &&
                      "Se repite mensualmente"}
                    {event.recurrenceRule.freq === "YEARLY" &&
                      "Se repite anualmente"}
                    {event.recurrenceRule.interval > 1 &&
                      ` cada ${event.recurrenceRule.interval}`}
                  </span>
                </div>
              )}

              {reminderMinutes !== null && (
                <div className="flex items-center gap-2.5">
                  <BellRing
                    size={14}
                    className="text-[hsl(var(--muted-foreground))] shrink-0"
                  />
                  <span className="text-sm text-[hsl(var(--muted-foreground))]">
                    {formatReminderLead(reminderMinutes)}
                    {reminderClock ? ` (${reminderClock})` : ""}
                  </span>
                </div>
              )}

              {event.attendees?.length > 0 && (
                <div className="flex items-start gap-2.5">
                  <Users
                    size={14}
                    className="text-[hsl(var(--muted-foreground))] mt-0.5 shrink-0"
                  />
                  <div className="space-y-0.5">
                    {event.attendees.map((att) => (
                      <div key={att.id} className="flex items-center gap-2">
                        <span className="text-sm text-[hsl(var(--foreground))]">
                          {att.user?.firstName} {att.user?.lastName}
                        </span>
                        <span className="text-[10px] text-[hsl(var(--muted-foreground))] bg-[hsl(var(--muted))] px-1.5 py-0.5 rounded">
                          {STATUS_LABELS[att.status] ?? att.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={deleteTitle}
        description={deleteDescription}
        confirmLabel="Eliminar"
        loading={deleteEvent.isPending}
        onConfirm={doDelete}
      />
    </>
  );
}
