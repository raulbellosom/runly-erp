import { CalendarDays, ChevronDown } from 'lucide-react'
import { Popover, PopoverTrigger, PopoverContent } from './Popover.jsx'
import { DatePickerField } from './DatePickerField.jsx'
import { formatDateDisplay } from './date-picker-shared.jsx'
import { cn } from '../lib/utils.js'

// Local YYYY-MM-DD (never toISOString(), which shifts the day to UTC).
function localIso(date) {
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${m}-${d}`
}

function daysAgo(n) {
  const date = new Date()
  date.setDate(date.getDate() - n)
  return date
}

const PRESETS = [
  { label: 'Hoy', range: () => [localIso(new Date()), localIso(new Date())] },
  { label: 'Últimos 7 días', range: () => [localIso(daysAgo(6)), localIso(new Date())] },
  { label: 'Últimos 30 días', range: () => [localIso(daysAgo(29)), localIso(new Date())] },
  { label: 'Este mes', range: () => { const now = new Date(); return [localIso(new Date(now.getFullYear(), now.getMonth(), 1)), localIso(now)] } },
  { label: 'Este año', range: () => { const now = new Date(); return [localIso(new Date(now.getFullYear(), 0, 1)), localIso(now)] } },
]

// Filter pill for a date range. `filter` = { key, label, fromKey, toKey };
// writes both keys into the FilterBar value object.
export function DateRangeFilter({ filter, value = {}, onChange }) {
  const from = value[filter.fromKey] || ''
  const to = value[filter.toKey] || ''
  const active = Boolean(from || to)
  const summary = from && to
    ? `${formatDateDisplay(from)} – ${formatDateDisplay(to)}`
    : from ? `Desde ${formatDateDisplay(from)}` : to ? `Hasta ${formatDateDisplay(to)}` : ''

  const set = (nextFrom, nextTo) => {
    // Keep the range ordered when the user picks an end before the start.
    const [a, b] = nextFrom && nextTo && nextFrom > nextTo ? [nextTo, nextFrom] : [nextFrom, nextTo]
    onChange({ ...value, [filter.fromKey]: a || '', [filter.toKey]: b || '' })
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors',
            active
              ? 'border-(--brand-primary) bg-(--brand-soft) text-[hsl(var(--foreground))]'
              : 'border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]',
          )}
        >
          <CalendarDays className="h-3.5 w-3.5 opacity-70" />
          {filter.label}
          {active && (
            <span className="rounded-full bg-(--brand-primary) px-1.5 text-[10px] font-bold text-(--brand-primary-foreground)">
              {summary}
            </span>
          )}
          <ChevronDown className="h-3 w-3 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-3 p-3" align="start">
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => set(...preset.range())}
              className="rounded-full border border-[hsl(var(--border))] px-2.5 py-1 text-xs text-[hsl(var(--foreground))] transition-colors hover:bg-[hsl(var(--muted))]"
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <DatePickerField label="Desde" value={from || undefined} onChange={(v) => set(v, to)} placeholder="Inicio" />
          <DatePickerField label="Hasta" value={to || undefined} onChange={(v) => set(from, v)} placeholder="Fin" />
        </div>
        {active && (
          <button
            type="button"
            onClick={() => set('', '')}
            className="w-full py-1 text-xs text-[hsl(var(--muted-foreground))] transition-colors hover:text-[hsl(var(--foreground))]"
          >
            Quitar rango
          </button>
        )}
      </PopoverContent>
    </Popover>
  )
}
