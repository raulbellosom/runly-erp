import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
} from "./Select.jsx";

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTE_STEP = 5;
const MINUTES = Array.from({ length: 60 / MINUTE_STEP }, (_, i) => i * MINUTE_STEP);
const MERIDIEMS = ["a.m.", "p.m."];

// The current minute may not land on a 5-minute step (e.g. an event synced
// from Google Calendar, or any legacy value) — inject it into the option
// list instead of silently rounding it away the moment the field opens.
function minuteOptions(current) {
  if (MINUTES.includes(current)) return MINUTES;
  return [...MINUTES, current].sort((a, b) => a - b);
}

// ── TimeWheel ────────────────────────────────────────────────────────────────
// Three compact dropdowns (hour / minute / meridiem) instead of scroll-snap
// wheels — picking a value is a single click/tap rather than a fiddly drag,
// while still never opening the device's native keyboard (Radix Select is a
// listbox, not a text input).
//
// Trigger label is rendered explicitly from props rather than via Radix's
// <Select.Value>: this codebase already hit a React 19 issue where
// Select.Value doesn't reliably reflect a programmatically-set value (see
// SelectField's selectedLabel workaround in FormFields.jsx) — sidestepped
// here by never relying on it in the first place.

export function TimeWheel({ hour, minute, meridiem, onChange }) {
  return (
    <div className="flex items-center justify-center gap-1">
      <Select
        value={String(hour)}
        onValueChange={(v) => onChange({ hour: Number(v), minute, meridiem })}
      >
        <SelectTrigger
          className="w-16 h-9 px-2 text-sm justify-center gap-1"
          aria-label="Hora"
        >
          <span>{hour}</span>
        </SelectTrigger>
        <SelectContent className="max-h-56">
          {HOURS.map((h) => (
            <SelectItem key={h} value={String(h)}>
              {h}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <span className="text-sm text-muted-foreground">:</span>

      <Select
        value={String(minute)}
        onValueChange={(v) => onChange({ hour, minute: Number(v), meridiem })}
      >
        <SelectTrigger
          className="w-16 h-9 px-2 text-sm justify-center gap-1"
          aria-label="Minutos"
        >
          <span>{String(minute).padStart(2, "0")}</span>
        </SelectTrigger>
        <SelectContent className="max-h-56">
          {minuteOptions(minute).map((m) => (
            <SelectItem key={m} value={String(m)}>
              {String(m).padStart(2, "0")}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={meridiem}
        onValueChange={(v) => onChange({ hour, minute, meridiem: v })}
      >
        <SelectTrigger
          className="w-18 h-9 px-2 text-sm justify-center gap-1"
          aria-label="a.m. o p.m."
        >
          <span>{meridiem}</span>
        </SelectTrigger>
        <SelectContent>
          {MERIDIEMS.map((mer) => (
            <SelectItem key={mer} value={mer}>
              {mer}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
