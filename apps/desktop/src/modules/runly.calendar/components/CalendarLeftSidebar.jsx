import { useState } from "react";
import {
  Plus,
  MoreHorizontal,
  Check,
  Pencil,
  Users,
  Trash2,
  Upload,
} from "lucide-react";
import {
  Button,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  LoadingState,
} from "@runly/ui";
import { useAuth } from "../../../auth/AuthProvider";
import MiniCalendar from "./MiniCalendar";
import { useCalendarStore } from "../stores/useCalendarStore";
import { useCalendars } from "../hooks/useCalendarData";
import { CalendarIcon } from "../calendarIcons";
import GoogleCalendarConnectionCard from "./GoogleCalendarConnectionCard";
import GoogleCalendarCalendarPickerDialog from "./GoogleCalendarCalendarPickerDialog";
import ImportIcsDialog from "./ImportIcsDialog";
import {
  canCreateCalendar,
  canDeleteCalendar,
  canManageCalendar,
} from "../lib/calendar-screen-access";

function CalendarColorToggle({ color, checked, label, onChange }) {
  const actionLabel = checked ? "Ocultar" : "Mostrar";
  return (
    <button
      type="button"
      onClick={onChange}
      aria-label={`${actionLabel} calendario ${label}`}
      aria-pressed={checked}
      title={`${actionLabel} calendario ${label}`}
      className="w-4 h-4 shrink-0 rounded-sm flex items-center justify-center transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
      style={{
        backgroundColor: checked ? color : "transparent",
        border: `2px solid ${color}`,
      }}
    >
      {checked && <Check size={9} color="#fff" strokeWidth={3} />}
    </button>
  );
}

function CalendarItem({
  cal,
  isActive,
  allIds,
  onToggle,
  onEdit,
  onManage,
  onDelete,
  canEdit,
  canShare,
  canDelete,
}) {
  const calColor = cal.color || "#6B46C1";
  const hasActions = canEdit || canShare || canDelete;
  return (
    <div className="flex items-center gap-2 py-1 group">
      <CalendarColorToggle
        color={calColor}
        checked={isActive}
        label={cal.name}
        onChange={() => onToggle(cal.id, allIds)}
      />
      {cal.icon && (
        <CalendarIcon
          name={cal.icon}
          size={14}
          color={calColor}
          className="shrink-0"
        />
      )}
      <button
        type="button"
        aria-label={`${isActive ? "Ocultar" : "Mostrar"} calendario ${cal.name}`}
        aria-pressed={isActive}
        onClick={() => onToggle(cal.id, allIds)}
        className="flex-1 min-w-0 truncate rounded-sm text-left text-xs text-[hsl(var(--foreground))] transition-colors hover:text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-1"
      >
        {cal.name}
      </button>
      {hasActions && (
        <div className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-[hsl(var(--muted-foreground))]"
                title="Opciones"
              >
                <MoreHorizontal size={12} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {canEdit && (
                <DropdownMenuItem onClick={() => onEdit(cal)}>
                  <Pencil size={13} className="mr-2 shrink-0" />
                  Editar calendario
                </DropdownMenuItem>
              )}
              {canEdit && canShare && <DropdownMenuSeparator />}
              {canShare && (
                <DropdownMenuItem onClick={() => onManage(cal)}>
                  <Users size={13} className="mr-2 shrink-0" />
                  Gestionar acceso
                </DropdownMenuItem>
              )}
              {(canEdit || canShare) && canDelete && <DropdownMenuSeparator />}
              {canDelete && (
                <DropdownMenuItem
                  onClick={() => onDelete(cal)}
                  className="text-[hsl(var(--destructive))] focus:text-[hsl(var(--destructive))]"
                >
                  <Trash2 size={13} className="mr-2 shrink-0" />
                  Eliminar calendario
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );
}

function SharedCalendarItem({ cal, isActive, allIds, onToggle }) {
  const calColor = cal.color || "#6B46C1";
  return (
    <div className="flex items-center gap-2 py-1">
      <CalendarColorToggle
        color={calColor}
        checked={isActive}
        label={cal.name}
        onChange={() => onToggle(cal.id, allIds)}
      />
      {cal.icon && (
        <CalendarIcon
          name={cal.icon}
          size={14}
          color={calColor}
          className="shrink-0"
        />
      )}
      <button
        type="button"
        aria-label={`${isActive ? "Ocultar" : "Mostrar"} calendario ${cal.name}`}
        aria-pressed={isActive}
        onClick={() => onToggle(cal.id, allIds)}
        className="flex-1 min-w-0 truncate rounded-sm text-left text-xs text-[hsl(var(--foreground))] transition-colors hover:text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-1"
      >
        {cal.name}
      </button>
    </div>
  );
}

export default function CalendarLeftSidebar({
  onNewCalendar,
  onEditCalendar,
  onShareCalendar,
  onDeleteCalendar,
}) {
  const [googlePickerOpen, setGooglePickerOpen] = useState(false);
  const [icsImportOpen, setIcsImportOpen] = useState(false);
  const { userProfile } = useAuth();
  const {
    selectedDate,
    setSelectedDate,
    activeCalendarIds,
    toggleCalendarFilter,
  } = useCalendarStore();
  const { data, isLoading } = useCalendars();
  const owned = data?.owned ?? [];
  const shared = data?.shared ?? [];
  const allowCreateCalendar = canCreateCalendar(userProfile);

  const allIds = [...owned.map((c) => c.id), ...shared.map((c) => c.id)];

  function isActive(id) {
    return activeCalendarIds.length === 0 || activeCalendarIds.includes(id);
  }

  return (
    <aside className="w-56 h-full shrink-0 flex flex-col border-r border-[hsl(var(--border))] bg-[hsl(var(--surface-2))] overflow-y-auto">
      <div className="pt-3">
        <MiniCalendar
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
        />
      </div>

      <div className="flex-1 px-3 pt-3 pb-4">
        <div className="flex min-h-full flex-col">
          <section>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                Mis calendarios
              </span>
              <Button
                onClick={onNewCalendar}
                variant="ghost"
                size="icon-sm"
                className="text-[hsl(var(--muted-foreground))]"
                title="Nuevo calendario"
                disabled={!allowCreateCalendar}
              >
                <Plus size={12} />
              </Button>
            </div>

            {isLoading && (
              <LoadingState variant="inline" size="sm" message="Cargando..." />
            )}

            {owned.map((cal) => (
              <CalendarItem
                key={cal.id}
                cal={cal}
                isActive={isActive(cal.id)}
                allIds={allIds}
                onToggle={toggleCalendarFilter}
                onEdit={onEditCalendar ?? (() => {})}
                onManage={onShareCalendar ?? (() => {})}
                onDelete={onDeleteCalendar ?? (() => {})}
                canEdit={canManageCalendar(
                  userProfile,
                  "calendar.calendars.update",
                )}
                canShare={canManageCalendar(userProfile, "calendar.share.manage")}
                canDelete={canDeleteCalendar({ userProfile, calendar: cal })}
              />
            ))}
          </section>

          {shared.length > 0 && (
            <section>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))] mb-2">
                Compartidos
              </div>
              {shared.map((cal) => (
                <SharedCalendarItem
                  key={cal.id}
                  cal={cal}
                  isActive={isActive(cal.id)}
                  allIds={allIds}
                  onToggle={toggleCalendarFilter}
                />
              ))}
            </section>
          )}

          <section className="mt-6 border-t border-[hsl(var(--border))] pt-4">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
              Integraciones
            </div>
            <GoogleCalendarConnectionCard
              onOpen={() => setGooglePickerOpen(true)}
            />
            <Button
              onClick={() => setIcsImportOpen(true)}
              variant="ghost"
              size="sm"
              className="mt-2 w-full justify-start text-[hsl(var(--muted-foreground))]"
            >
              <Upload size={14} className="mr-2" />
              Importar .ics
            </Button>
          </section>
        </div>
      </div>

      <GoogleCalendarCalendarPickerDialog
        open={googlePickerOpen}
        onClose={() => setGooglePickerOpen(false)}
      />

      <ImportIcsDialog
        open={icsImportOpen}
        onOpenChange={setIcsImportOpen}
      />
    </aside>
  );
}
