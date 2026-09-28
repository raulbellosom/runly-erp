// CALENDAR records view: month grid (Monday-first) on desktop, an agenda list
// grouped by day on phones where a 7-column grid is unreadable. The parent
// owns the visible month and re-queries with its date range.
import { Button } from "../components/Button.jsx";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { accentFor, dayKey, fieldMap, formatFieldValue, toLocalDate } from "./records-view-format.js";

const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const monthFmt = new Intl.DateTimeFormat("es-MX", { month: "long", year: "numeric" });
const agendaDayFmt = new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "long" });
const MAX_CHIPS = 3;

export function monthRange(month) {
  const from = new Date(month.getFullYear(), month.getMonth(), 1);
  const to = new Date(month.getFullYear(), month.getMonth() + 1, 1);
  return { from: dayKey(from), to: dayKey(to) };
}

function gridDays(month) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - offset);
  return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

function Chip({ record, schema, titleField, colorField, onOpen }) {
  const color = colorField ? accentFor(colorField, record[schema.colorField]) : "hsl(var(--primary))";
  const label = formatFieldValue(titleField, record[schema.titleField]);
  const Tag = onOpen ? "button" : "span";
  return (
    <Tag
      type={onOpen ? "button" : undefined}
      onClick={onOpen ? () => onOpen(record.id) : undefined}
      title={label}
      className={`flex w-full items-center gap-1.5 truncate rounded-md px-1.5 py-0.5 text-left text-xs ${onOpen ? "cursor-pointer hover:bg-[hsl(var(--muted))]" : ""}`}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <span className="truncate">{label}</span>
    </Tag>
  );
}

export function RunlyCalendarView({ schema, data, month, onMonthChange, onOpen }) {
  const fields = fieldMap(data.fields);
  const titleField = fields.get(schema.titleField);
  const colorField = fields.get(schema.colorField);
  const byDay = new Map();
  for (const record of data.records) {
    const date = toLocalDate(record[schema.dateField]);
    if (!date) continue;
    const key = dayKey(date);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(record);
  }
  const todayKey = dayKey(new Date());
  const shift = (delta) => onMonthChange(new Date(month.getFullYear(), month.getMonth() + delta, 1));
  const agendaDays = [...byDay.keys()].sort();

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold capitalize">{monthFmt.format(month)}</h2>
        <div className="flex items-center gap-1">
          <Button size="icon" variant="outline" aria-label="Mes anterior" onClick={() => shift(-1)}><ChevronLeft className="h-4 w-4" /></Button>
          <Button size="sm" variant="outline" onClick={() => onMonthChange(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>Hoy</Button>
          <Button size="icon" variant="outline" aria-label="Mes siguiente" onClick={() => shift(1)}><ChevronRight className="h-4 w-4" /></Button>
        </div>
      </div>

      {colorField?.options?.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[hsl(var(--muted-foreground))]">
          {colorField.options.map((option) => {
            const value = typeof option === "object" ? option.value : option;
            return (
              <span key={String(value)} className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: accentFor(colorField, value) }} />
                {formatFieldValue(colorField, value)}
              </span>
            );
          })}
        </div>
      )}

      <div className="hidden overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] sm:block">
        <div className="grid grid-cols-7 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]/50">
          {WEEKDAYS.map((day) => <div key={day} className="px-2 py-2 text-xs font-medium text-[hsl(var(--muted-foreground))]">{day}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {gridDays(month).map((date) => {
            const key = dayKey(date);
            const records = byDay.get(key) ?? [];
            const inMonth = date.getMonth() === month.getMonth();
            return (
              <div key={key} className={`min-h-28 space-y-1 border-b border-r border-[hsl(var(--border))] p-1.5 [&:nth-child(7n)]:border-r-0 ${inMonth ? "" : "bg-[hsl(var(--muted))]/30"}`}>
                <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs tabular-nums ${key === todayKey ? "bg-[hsl(var(--primary))] font-semibold text-[hsl(var(--primary-foreground))]" : inMonth ? "" : "text-[hsl(var(--muted-foreground))]"}`}>
                  {date.getDate()}
                </span>
                {records.slice(0, MAX_CHIPS).map((record) => (
                  <Chip key={record.id} record={record} schema={schema} titleField={titleField} colorField={colorField} onOpen={onOpen} />
                ))}
                {records.length > MAX_CHIPS && <p className="px-1.5 text-xs text-[hsl(var(--muted-foreground))]">+{records.length - MAX_CHIPS} más</p>}
              </div>
            );
          })}
        </div>
      </div>

      <div className="space-y-3 sm:hidden">
        {agendaDays.map((key) => (
          <section key={key} className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3">
            <h3 className={`mb-1 text-sm font-medium capitalize ${key === todayKey ? "text-[hsl(var(--primary))]" : ""}`}>{agendaDayFmt.format(toLocalDate(key))}</h3>
            {byDay.get(key).map((record) => (
              <Chip key={record.id} record={record} schema={schema} titleField={titleField} colorField={colorField} onOpen={onOpen} />
            ))}
          </section>
        ))}
        {!agendaDays.length && (
          <p className="flex items-center gap-2 rounded-2xl border border-dashed border-[hsl(var(--border))] p-4 text-sm text-[hsl(var(--muted-foreground))]">
            <CalendarDays className="h-4 w-4" />
            Sin registros este mes.
          </p>
        )}
      </div>
    </div>
  );
}
