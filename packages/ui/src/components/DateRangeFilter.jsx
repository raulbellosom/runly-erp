import { useState } from 'react'
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { Popover, PopoverTrigger, PopoverContent } from './Popover.jsx'
import { Button } from './Button.jsx'
import { DAYS_HEADER, MONTHS, buildCalendarGrid, parseDate } from './date-picker-shared.jsx'
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
  { label: 'Mes anterior', range: () => { const now = new Date(); return [localIso(new Date(now.getFullYear(), now.getMonth() - 1, 1)), localIso(new Date(now.getFullYear(), now.getMonth(), 0))] } },
  { label: 'Este año', range: () => { const now = new Date(); return [localIso(new Date(now.getFullYear(), 0, 1)), localIso(now)] } },
]

const short = (value, withYear = true) => {
  const d = parseDate(value)
  return d ? format(d, withYear ? 'd MMM yyyy' : 'd MMM', { locale: es }) : ''
}

function summaryOf(from, to) {
  if (from && to) {
    if (from === to) return short(from)
    const sameYear = from.slice(0, 4) === to.slice(0, 4)
    return `${short(from, !sameYear)} – ${short(to)}`
  }
  if (from) return `Desde ${short(from)}`
  if (to) return `Hasta ${short(to)}`
  return ''
}

// Single-month calendar that picks a range: first click sets the start, the
// second the end (clicking before the start restarts the range). Hover
// previews the range being picked.
function RangeCalendar({ from, to, onPick }) {
  const initial = parseDate(from || to) ?? new Date()
  const [year, setYear] = useState(initial.getFullYear())
  const [month, setMonth] = useState(initial.getMonth())
  const [hover, setHover] = useState('')
  const todayIso = localIso(new Date())
  const cells = buildCalendarGrid(year, month)
  const iso = (day) => localIso(new Date(year, month, day))
  const picking = Boolean(from && !to)
  const end = picking && hover > from ? hover : to

  const shift = (delta) => {
    const next = new Date(year, month + delta, 1)
    setYear(next.getFullYear())
    setMonth(next.getMonth())
  }

  function pick(day) {
    const value = iso(day)
    if (!from || to || value < from) onPick(value, '')
    else onPick(from, value)
  }

  return (
    <div className="w-full select-none" onMouseLeave={() => setHover('')}>
      <div className="mb-2 flex items-center justify-between">
        <button type="button" onClick={() => shift(-1)} aria-label="Mes anterior"
          className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-[hsl(var(--muted))]">
          <ChevronLeft size={16} />
        </button>
        <span className="text-sm font-semibold">{MONTHS[month]} {year}</span>
        <button type="button" onClick={() => shift(1)} aria-label="Mes siguiente"
          className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-[hsl(var(--muted))]">
          <ChevronRight size={16} />
        </button>
      </div>
      <div className="mb-1 grid grid-cols-7">
        {DAYS_HEADER.map((d) => (
          <div key={d} className="py-1 text-center text-[11px] font-medium text-[hsl(var(--muted-foreground))]">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-1">
        {cells.map((day, i) => {
          if (!day) return <div key={i} />
          const value = iso(day)
          const isStart = value === from
          const isEnd = value === end
          const inRange = from && end && value > from && value < end
          const edge = isStart || isEnd
          return (
            <div
              key={i}
              className={cn(
                'flex h-9 items-center justify-center',
                inRange && 'bg-(--brand-soft)',
                isStart && end && end !== from && 'rounded-l-full bg-(--brand-soft)',
                isEnd && from && end !== from && 'rounded-r-full bg-(--brand-soft)',
              )}
            >
              <button
                type="button"
                onClick={() => pick(day)}
                onMouseEnter={() => setHover(value)}
                className={cn(
                  'flex h-9 w-9 items-center justify-center rounded-full text-sm transition-colors',
                  edge
                    ? 'bg-(--brand-primary) font-semibold text-(--brand-primary-foreground)'
                    : 'text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]',
                  !edge && value === todayIso && 'font-semibold ring-1 ring-inset ring-(--brand-primary)',
                )}
              >
                {day}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function DateBox({ label, value, active }) {
  return (
    <div className={cn(
      'min-w-0 flex-1 rounded-xl border px-3 py-2 transition-colors',
      active ? 'border-(--brand-primary) bg-(--brand-soft)' : 'border-[hsl(var(--border))]',
    )}>
      <p className="text-[10px] font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]">{label}</p>
      <p className={cn('truncate text-sm', value ? 'font-medium text-[hsl(var(--foreground))]' : 'text-[hsl(var(--muted-foreground))]')}>
        {value ? short(value) : 'Sin definir'}
      </p>
    </div>
  )
}

// Filter pill for a date range. `filter` = { key, label, fromKey, toKey };
// writes both keys into the FilterBar value object.
export function DateRangeFilter({ filter, value = {}, onChange }) {
  const [open, setOpen] = useState(false)
  const from = value[filter.fromKey] || ''
  const to = value[filter.toKey] || ''
  const active = Boolean(from || to)
  const set = (nextFrom, nextTo) => onChange({ ...value, [filter.fromKey]: nextFrom || '', [filter.toKey]: nextTo || '' })
  const activePreset = PRESETS.find((p) => { const [a, b] = p.range(); return a === from && b === to })

  return (
    <Popover open={open} onOpenChange={setOpen}>
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
              {activePreset?.label ?? summaryOf(from, to)}
            </span>
          )}
          <ChevronDown className="h-3 w-3 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(34rem,calc(100vw-2rem))] p-0">
        <div className="flex flex-col sm:flex-row">
          <div className="flex gap-1 overflow-x-auto border-b border-[hsl(var(--border))] p-2 sm:w-40 sm:shrink-0 sm:flex-col sm:overflow-visible sm:border-b-0 sm:border-r">
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => { set(...preset.range()); setOpen(false) }}
                className={cn(
                  'shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm transition-colors',
                  activePreset === preset
                    ? 'bg-(--brand-soft) font-medium text-[hsl(var(--foreground))]'
                    : 'text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]',
                )}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <div className="min-w-0 flex-1 space-y-3 p-4">
            <div className="flex gap-2">
              <DateBox label="Desde" value={from} active={!from || (from && to)} />
              <DateBox label="Hasta" value={to} active={Boolean(from && !to)} />
            </div>
            <RangeCalendar from={from} to={to} onPick={set} />
            <div className="flex items-center justify-between border-t border-[hsl(var(--border))] pt-3">
              <button
                type="button"
                onClick={() => set('', '')}
                disabled={!active}
                className="text-xs text-[hsl(var(--muted-foreground))] transition-colors hover:text-[hsl(var(--foreground))] disabled:opacity-40"
              >
                Quitar rango
              </button>
              <Button type="button" size="sm" onClick={() => setOpen(false)}>Listo</Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
