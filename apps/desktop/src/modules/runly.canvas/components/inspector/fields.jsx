import { useState } from 'react'
import { cn } from '@runly/ui'
import { Check } from 'lucide-react'

export function Section({ title, children, action }) {
  return (
    <section className="space-y-2.5">
      <div className="flex h-7 items-center justify-between px-0.5">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[hsl(var(--muted-foreground))]">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

export function FieldLabel({ children }) {
  return <span className="mb-1 block text-xs text-[hsl(var(--muted-foreground))]">{children}</span>
}

// Numeric input that edits a local draft and commits on Enter or blur, so
// typing "1" on the way to "120" never fires an intermediate save.
export function NumberInput({ label, short, value, onCommit, suffix, min, max, disabled }) {
  const shown = Number.isFinite(value) ? String(Math.round(value)) : ''
  const [draft, setDraft] = useState(null)
  const commit = () => {
    if (draft === null) return
    const parsed = Number(draft.replace(',', '.'))
    setDraft(null)
    if (!Number.isFinite(parsed) || String(Math.round(parsed)) === shown) return
    onCommit(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, parsed)))
  }
  return (
    <label className="block min-w-0">
      <span className="sr-only">{label}</span>
      <span className={cn(
        'flex h-11 items-center gap-1.5 rounded-lg border border-[hsl(var(--input))] bg-[hsl(var(--card))] px-2.5 transition-colors sm:h-9',
        'focus-within:border-[hsl(var(--ring))] focus-within:ring-2 focus-within:ring-[hsl(var(--ring))]/30',
        disabled && 'opacity-50',
      )}>
        <span aria-hidden title={label} className="w-5 shrink-0 text-[11px] font-semibold text-[hsl(var(--muted-foreground))]">{short ?? label.slice(0, 1)}</span>
        <input
          type="text"
          inputMode="decimal"
          disabled={disabled}
          aria-label={label}
          value={draft ?? shown}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') { event.preventDefault(); commit(); event.currentTarget.blur() }
            if (event.key === 'Escape') { setDraft(null); event.currentTarget.blur() }
          }}
          className="min-w-0 flex-1 bg-transparent font-mono text-sm tabular-nums text-[hsl(var(--foreground))] outline-none"
        />
        {suffix ? <span className="shrink-0 text-xs text-[hsl(var(--muted-foreground))]">{suffix}</span> : null}
      </span>
    </label>
  )
}

export function ColorSwatches({ label, value, colors, onChange, allowNone, noneLabel = 'Sin color' }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div role="radiogroup" aria-label={label} className="grid grid-cols-7 gap-1.5">
        {allowNone ? (
          <button
            type="button"
            role="radio"
            aria-checked={value === 'none'}
            aria-label={noneLabel}
            title={noneLabel}
            onClick={() => onChange('none')}
            className={cn(
              'relative h-8 w-full cursor-pointer overflow-hidden rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
              value === 'none' && 'ring-2 ring-[hsl(var(--foreground))]',
            )}
          >
            <span aria-hidden className="absolute left-1/2 top-1/2 h-px w-[140%] -translate-x-1/2 -translate-y-1/2 -rotate-45 bg-red-500" />
          </button>
        ) : null}
        {colors.map((hex) => {
          const active = String(value ?? '').toLowerCase() === hex
          return (
            <button
              key={hex}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={hex}
              title={hex}
              onClick={() => onChange(hex)}
              style={{ backgroundColor: hex }}
              className={cn(
                'flex h-8 w-full cursor-pointer items-center justify-center rounded-md border border-black/10',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-1',
                active && 'ring-2 ring-[hsl(var(--foreground))] ring-offset-1 ring-offset-[hsl(var(--card))]',
              )}
            >
              {active ? <Check className="h-3.5 w-3.5 text-white drop-shadow" strokeWidth={3} /> : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function Choice({ label, value, options, onChange }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div role="radiogroup" aria-label={label} className="flex gap-0.5 rounded-lg bg-[hsl(var(--muted)/0.7)] p-0.5">
        {options.map((option) => {
          const active = option.value === value
          return (
            <button
              key={String(option.value)}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={option.ariaLabel ?? (typeof option.label === 'string' ? option.label : String(option.value))}
              title={option.ariaLabel}
              onClick={() => onChange(option.value)}
              className={cn(
                'flex h-9 min-w-0 flex-1 cursor-pointer items-center justify-center rounded-md px-1 text-xs font-medium tabular-nums transition-colors sm:h-7',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
                active ? 'bg-[hsl(var(--card))] text-[hsl(var(--foreground))] shadow-sm' : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]',
              )}
            >
              {option.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
