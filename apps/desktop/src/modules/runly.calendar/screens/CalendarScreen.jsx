import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import {
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import { ConfirmDialog } from "@runly/ui";
import { toast } from "sonner";
import { useCalendarStore } from "../stores/useCalendarStore";
import CalendarToolbar from "../components/CalendarToolbar";
import CalendarLeftSidebar from "../components/CalendarLeftSidebar";
import CalendarRightSidebar from "../components/CalendarRightSidebar";
import MonthView from "../components/MonthView";
import WeekView from "../components/WeekView";
import DayView from "../components/DayView";
import AgendaView from "../components/AgendaView";
import EventDetailModal from "../components/EventDetailModal";
import EventFormModal from "../components/EventFormModal";
import CalendarFormModal from "../components/CalendarFormModal";
import CalendarShareModal from "../components/CalendarShareModal";
import { useDeleteCalendar, useCalendarEvent } from "../hooks/useCalendarData";

function useNarrow(breakpoint = 640) {
  const [narrow, setNarrow] = useState(
    () => typeof window !== "undefined" && window.innerWidth < breakpoint,
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const fn = (e) => setNarrow(e.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, [breakpoint]);
  return narrow;
}

export default function CalendarScreen() {
  const {
    activeView,
    selectedDate,
    setSelectedDate,
    leftSidebarOpen,
    rightSidebarOpen,
    toggleLeftSidebar,
    toggleRightSidebar,
  } = useCalendarStore();

  const isNarrow = useNarrow();

  const [searchParams, setSearchParams] = useSearchParams();

  // Capture the deep-link event ID before clearing the URL param.
  const [deepLinkEventId] = useState(() => {
    const open = searchParams.get("open");
    if (typeof open === "string" && open.startsWith("event:")) {
      return open.slice("event:".length) || null;
    }
    return null;
  });

  // Clear ?open from the URL immediately so back-navigation doesn't re-trigger the modal.
  useEffect(() => {
    if (searchParams.has("open")) {
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data: deepLinkEventData, isError: deepLinkEventError } = useCalendarEvent(deepLinkEventId);

  // Open the modal immediately with a loading skeleton so the user sees feedback at once.
  useEffect(() => {
    if (!deepLinkEventId) return;
    setDetailEvent({ id: deepLinkEventId, _isLoading: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Replace the loading skeleton with real event data once it arrives.
  useEffect(() => {
    if (!deepLinkEventId || !deepLinkEventData) return;
    const event = deepLinkEventData?.data ?? deepLinkEventData;
    if (event?.id) {
      setDetailEvent(event);
    }
  }, [deepLinkEventId, deepLinkEventData]);

  // Close the loading modal and show an error toast if the event no longer exists.
  useEffect(() => {
    if (!deepLinkEventId || !deepLinkEventError) return;
    setDetailEvent(null);
    toast.error("El evento no existe o ya fue eliminado.");
  }, [deepLinkEventId, deepLinkEventError]);

  // Close both sidebars when the window becomes narrow
  const prevNarrow = useRef(isNarrow);
  useEffect(() => {
    if (isNarrow && !prevNarrow.current) {
      if (leftSidebarOpen) toggleLeftSidebar();
      if (rightSidebarOpen) toggleRightSidebar();
    }
    prevNarrow.current = isNarrow;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNarrow]);

  // Close both sidebars on mount when starting out narrow — the sidebar
  // open/closed flags persist across reloads (useCalendarStore), so on a
  // mobile load/reload the transition effect above never fires (isNarrow
  // was already true at mount, no false->true edge to catch) and the
  // persisted-open sidebars would render as full-screen overlays instead
  // of the calendar.
  useEffect(() => {
    if (isNarrow) {
      if (leftSidebarOpen) toggleLeftSidebar();
      if (rightSidebarOpen) toggleRightSidebar();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [detailEvent, setDetailEvent] = useState(null);
  const [formState, setFormState] = useState(null);
  const [calendarForm, setCalendarForm] = useState(null);
  const [shareCalendar, setShareCalendar] = useState(null);
  const [deleteCalendarTarget, setDeleteCalendarTarget] = useState(null);
  const deleteCalendarMutation = useDeleteCalendar();

  function openNewEvent() {
    setFormState({ _isNew: true, defaultDate: selectedDate });
  }

  function openEditEvent(event) {
    setDetailEvent(null);
    setFormState(event);
  }

  async function handleConfirmDeleteCalendar() {
    if (!deleteCalendarTarget?.id) return;

    try {
      await deleteCalendarMutation.mutateAsync(deleteCalendarTarget.id);
      toast.success("Calendario eliminado");
      setDeleteCalendarTarget(null);
    } catch (err) {
      toast.error(err?.message || "No se pudo eliminar el calendario");
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[hsl(var(--surface-1))]">
      {/* Top toolbar row */}
      <div className="flex items-center gap-1 border-b border-[hsl(var(--border))] shrink-0">
        <button
          onClick={toggleLeftSidebar}
          className="p-2 ml-2 rounded hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] shrink-0"
          title={
            leftSidebarOpen
              ? "Ocultar sidebar izquierdo"
              : "Mostrar sidebar izquierdo"
          }
        >
          {leftSidebarOpen ? (
            <PanelLeftClose size={16} />
          ) : (
            <PanelLeftOpen size={16} />
          )}
        </button>

        <div className="flex-1 min-w-0">
          <CalendarToolbar onNewEvent={openNewEvent} />
        </div>

        <button
          onClick={toggleRightSidebar}
          className="p-2 mr-2 rounded hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] shrink-0"
          title={
            rightSidebarOpen ? "Ocultar panel derecho" : "Mostrar panel derecho"
          }
        >
          {rightSidebarOpen ? (
            <PanelRightClose size={16} />
          ) : (
            <PanelRightOpen size={16} />
          )}
        </button>
      </div>

      {/* Main area */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Left sidebar — inline on desktop, overlay on narrow */}
        {leftSidebarOpen && (
          <>
            {isNarrow && (
              <div
                className="absolute inset-0 z-40 bg-black/40"
                onClick={toggleLeftSidebar}
              />
            )}
            <div
              className={
                isNarrow ? "absolute left-0 top-0 bottom-0 z-50 shadow-xl" : ""
              }
            >
              <CalendarLeftSidebar
                onNewCalendar={() => setCalendarForm(true)}
                onEditCalendar={(cal) => setCalendarForm(cal)}
                onShareCalendar={(cal) => setShareCalendar(cal)}
                onDeleteCalendar={(cal) => setDeleteCalendarTarget(cal)}
              />
            </div>
          </>
        )}

        <div className="flex-1 flex overflow-hidden min-w-0">
          {activeView === "month" && (
            <MonthView
              onEventClick={setDetailEvent}
              onDayClick={(dateStr) => setSelectedDate(dateStr)}
              onNewEvent={(dateStr) => {
                setSelectedDate(dateStr);
                setFormState({ _isNew: true, defaultDate: dateStr });
              }}
            />
          )}
          {activeView === "week" && <WeekView onEventClick={setDetailEvent} />}
          {activeView === "day" && <DayView onEventClick={setDetailEvent} />}
          {activeView === "agenda" && (
            <AgendaView onEventClick={setDetailEvent} />
          )}
        </div>

        {/* Right sidebar — inline on desktop, overlay on narrow */}
        {rightSidebarOpen && (
          <>
            {isNarrow && (
              <div
                className="absolute inset-0 z-40 bg-black/40"
                onClick={toggleRightSidebar}
              />
            )}
            <div
              className={
                isNarrow ? "absolute right-0 top-0 bottom-0 z-50 shadow-xl" : ""
              }
            >
              <CalendarRightSidebar onNewEvent={openNewEvent} />
            </div>
          </>
        )}
      </div>

      {/* Modals */}
      {detailEvent && (
        <EventDetailModal
          event={detailEvent}
          onClose={() => setDetailEvent(null)}
          onEdit={openEditEvent}
          canEdit
          canDelete
        />
      )}

      {formState !== null && (
        <EventFormModal
          event={formState?._isNew ? undefined : formState}
          defaultDate={formState?._isNew ? selectedDate : undefined}
          onClose={() => setFormState(null)}
          onSaved={() => setFormState(null)}
        />
      )}

      {calendarForm !== null && (
        <CalendarFormModal
          calendar={calendarForm === true ? undefined : calendarForm}
          onClose={() => setCalendarForm(null)}
        />
      )}

      {shareCalendar && (
        <CalendarShareModal
          calendar={shareCalendar}
          onClose={() => setShareCalendar(null)}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleteCalendarTarget)}
        onOpenChange={(v) => !v && setDeleteCalendarTarget(null)}
        title="Eliminar calendario"
        description="Se eliminarán permanentemente todos los eventos de este calendario. Esta acción no se puede deshacer."
        detail={deleteCalendarTarget?.name}
        confirmLabel="Eliminar"
        onConfirm={handleConfirmDeleteCalendar}
        loading={deleteCalendarMutation.isPending}
      />
    </div>
  );
}
