import { useState, useCallback } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Popover, PopoverTrigger, PopoverContent } from "./Popover.jsx";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "./Sheet.jsx";
import { useIsMobile } from "../hooks/useIsMobile.js";
import { cn } from "../lib/utils.js";

const MONTHS = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

const DAYS_HEADER = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sa", "Do"];

export function parseDate(value) {
  if (!value) return null;
  const str = String(value);
  const datePart = str.includes("T") ? str.slice(0, 10) : str;
  const d = new Date(`${datePart}T12:00:00`);
  return isNaN(d.getTime()) ? null : d;
}

function toISO(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function formatDateDisplay(value) {
  const d = parseDate(value);
  if (!d) return "";
  return format(d, "d 'de' MMMM, yyyy", { locale: es });
}

// ── Date-time value helpers ────────────────────────────────────────────────
// DateTimeField's on-the-wire value format is "YYYY-MM-DDTHH:mm" (the same
// format <input type="datetime-local"> produced), so existing consumers
// (e.g. EventFormModal's toLocalDatetime) need no changes.

export function parseDateTimeValue(value) {
  if (!value) return { date: undefined, hour: 9, minute: 0, meridiem: "a.m." };
  const str = String(value);
  const datePart = str.slice(0, 10);
  const timePart = str.includes("T") ? str.slice(11, 16) : "00:00";
  const [hStr, mStr] = timePart.split(":");
  const h = Number(hStr) || 0;
  const minuteRaw = Number(mStr) || 0;
  const meridiem = h >= 12 ? "p.m." : "a.m.";
  let hour = h % 12;
  if (hour === 0) hour = 12;
  return { date: datePart, hour, minute: minuteRaw, meridiem };
}

export function composeDateTimeValue(datePart, hour, minute, meridiem) {
  if (!datePart) return "";
  let h24 = hour % 12;
  if (meridiem === "p.m.") h24 += 12;
  const hh = String(h24).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");
  return `${datePart}T${hh}:${mm}`;
}

export function formatDateTimeDisplay(value) {
  const d = parseDate(value);
  if (!d) return "";
  const str = String(value);
  const timePart = str.includes("T") ? str.slice(11, 16) : "00:00";
  const [hStr, mStr] = timePart.split(":");
  const h = Number(hStr) || 0;
  const displayHour = h % 12 === 0 ? 12 : h % 12;
  const meridiem = h >= 12 ? "p.m." : "a.m.";
  const datePart = format(d, "d MMM yyyy", { locale: es });
  return `${datePart}, ${displayHour}:${String(mStr ?? "00").padStart(2, "0")} ${meridiem}`;
}

function buildCalendarGrid(year, month) {
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // Monday = 0 offset
  const startDow = (firstDay.getDay() + 6) % 7;
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

// ── Calendar ─────────────────────────────────────────────────────────────────

const YEAR_PAGE_SIZE = 12;

export function Calendar({ value, onChange, onClose }) {
  const today = new Date();
  const selected = parseDate(value);

  const [viewYear, setViewYear] = useState(
    selected?.getFullYear() ?? today.getFullYear(),
  );
  const [viewMonth, setViewMonth] = useState(
    selected?.getMonth() ?? today.getMonth(),
  );
  const [view, setView] = useState("day");

  const cells = buildCalendarGrid(viewYear, viewMonth);

  function prevMonth() {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else setViewMonth((m) => m - 1);
  }

  function nextMonth() {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else setViewMonth((m) => m + 1);
  }

  function selectDay(day) {
    if (!day) return;
    onChange(toISO(viewYear, viewMonth, day));
    onClose();
  }

  function selectMonth(monthIndex) {
    setViewMonth(monthIndex);
    setView("day");
  }

  function selectYear(year) {
    setViewYear(year);
    setView("month");
  }

  const isToday = useCallback(
    (day) => {
      return (
        day &&
        today.getFullYear() === viewYear &&
        today.getMonth() === viewMonth &&
        today.getDate() === day
      );
    },
    [viewYear, viewMonth],
  );

  const isSelected = useCallback(
    (day) => {
      return (
        day &&
        selected?.getFullYear() === viewYear &&
        selected?.getMonth() === viewMonth &&
        selected?.getDate() === day
      );
    },
    [selected, viewYear, viewMonth],
  );

  const yearPageStart = viewYear - (((viewYear % YEAR_PAGE_SIZE) + YEAR_PAGE_SIZE) % YEAR_PAGE_SIZE);
  const yearPage = Array.from({ length: YEAR_PAGE_SIZE }, (_, i) => yearPageStart + i);

  const headerLeftAction =
    view === "day" ? prevMonth : view === "year" ? () => setViewYear((y) => y - YEAR_PAGE_SIZE) : () => setViewYear((y) => y - 1);
  const headerRightAction =
    view === "day" ? nextMonth : view === "year" ? () => setViewYear((y) => y + YEAR_PAGE_SIZE) : () => setViewYear((y) => y + 1);
  const headerLeftLabel = view === "day" ? "Mes anterior" : view === "year" ? "Años anteriores" : "Año anterior";
  const headerRightLabel = view === "day" ? "Mes siguiente" : view === "year" ? "Años siguientes" : "Año siguiente";

  return (
    <div className="select-none w-full">
      <div className="flex items-center justify-between mb-3">
        <button
          type="button"
          onClick={headerLeftAction}
          className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-[hsl(var(--muted))] transition-colors"
          aria-label={headerLeftLabel}
        >
          <ChevronLeft size={14} />
        </button>

        {view === "day" && (
          <span className="text-sm font-semibold flex items-center gap-1">
            <button
              type="button"
              onClick={() => setView("month")}
              className="rounded px-1.5 py-0.5 hover:bg-[hsl(var(--muted))] transition-colors"
            >
              {MONTHS[viewMonth]}
            </button>
            <button
              type="button"
              onClick={() => setView("year")}
              className="rounded px-1.5 py-0.5 hover:bg-[hsl(var(--muted))] transition-colors"
            >
              {viewYear}
            </button>
          </span>
        )}
        {view === "month" && (
          <button
            type="button"
            onClick={() => setView("year")}
            className="text-sm font-semibold rounded px-1.5 py-0.5 hover:bg-[hsl(var(--muted))] transition-colors"
          >
            {viewYear}
          </button>
        )}
        {view === "year" && (
          <span className="text-sm font-semibold">
            {yearPageStart}–{yearPageStart + YEAR_PAGE_SIZE - 1}
          </span>
        )}

        <button
          type="button"
          onClick={headerRightAction}
          className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-[hsl(var(--muted))] transition-colors"
          aria-label={headerRightLabel}
        >
          <ChevronRight size={14} />
        </button>
      </div>

      {view === "day" && (
        <>
          <div className="grid grid-cols-7 mb-1">
            {DAYS_HEADER.map((d) => (
              <div
                key={d}
                className="text-center text-[10px] font-medium text-[hsl(var(--muted-foreground))] py-1"
              >
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-y-0.5">
            {cells.map((day, i) => {
              const sel = isSelected(day);
              const tod = isToday(day);
              return (
                <button
                  key={i}
                  type="button"
                  disabled={!day}
                  onClick={() => selectDay(day)}
                  className={cn(
                    "h-8 w-8 mx-auto flex items-center justify-center rounded-full text-sm transition-colors",
                    !day && "invisible",
                    day &&
                      !sel &&
                      !tod &&
                      "hover:bg-[hsl(var(--muted))] text-[hsl(var(--foreground))]",
                    tod && !sel && "font-semibold text-[hsl(var(--primary))] ring-1 ring-inset ring-[hsl(var(--primary))]",
                    sel &&
                      "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] font-semibold hover:bg-[hsl(var(--primary))]/90",
                  )}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </>
      )}

      {view === "month" && (
        <div className="grid grid-cols-3 gap-1.5">
          {MONTHS.map((label, index) => {
            const sel = index === viewMonth && viewYear === (selected?.getFullYear() ?? NaN);
            const tod = index === today.getMonth() && viewYear === today.getFullYear();
            return (
              <button
                key={label}
                type="button"
                onClick={() => selectMonth(index)}
                className={cn(
                  "h-10 rounded-lg text-xs font-medium transition-colors",
                  !sel && !tod && "hover:bg-[hsl(var(--muted))] text-[hsl(var(--foreground))]",
                  tod && !sel && "font-semibold text-[hsl(var(--primary))] ring-1 ring-inset ring-[hsl(var(--primary))]",
                  sel && "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]",
                )}
              >
                {label.slice(0, 3)}
              </button>
            );
          })}
        </div>
      )}

      {view === "year" && (
        <div className="grid grid-cols-3 gap-1.5">
          {yearPage.map((year) => {
            const sel = year === (selected?.getFullYear() ?? NaN);
            const tod = year === today.getFullYear();
            return (
              <button
                key={year}
                type="button"
                onClick={() => selectYear(year)}
                className={cn(
                  "h-10 rounded-lg text-xs font-medium transition-colors",
                  !sel && !tod && "hover:bg-[hsl(var(--muted))] text-[hsl(var(--foreground))]",
                  tod && !sel && "font-semibold text-[hsl(var(--primary))] ring-1 ring-inset ring-[hsl(var(--primary))]",
                  sel && "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]",
                )}
              >
                {year}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── DateSelectorShell ──────────────────────────────────────────────────────
// Desktop: Popover anchored to the trigger (unchanged from DatePickerField's
// original behavior). Mobile: the unified bottom Sheet, so every date/time
// field in the app opens with the same handle/drag-to-dismiss/safe-area
// behavior established for Dialog and Sheet.

export function DateSelectorShell({
  open,
  onOpenChange,
  trigger,
  title,
  children,
  footer,
}) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetTrigger asChild>{trigger}</SheetTrigger>
        <SheetContent side="bottom">
          {title && (
            <SheetHeader>
              <SheetTitle>{title}</SheetTitle>
            </SheetHeader>
          )}
          <div className="flex flex-col items-center gap-4 w-full">
            {children}
          </div>
          {footer}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-3">
        {children}
        {footer}
      </PopoverContent>
    </Popover>
  );
}
