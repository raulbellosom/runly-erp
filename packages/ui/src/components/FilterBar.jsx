import { ChevronDown, X } from 'lucide-react'
import { Popover, PopoverTrigger, PopoverContent } from './Popover.jsx'
import { cn } from '../lib/utils.js'
import { DateRangeFilter } from './DateRangeFilter.jsx'

export function FilterBar({ filters = [], value = {}, onChange, className }) {
  const activeCount = Object.values(value).filter(Boolean).length

  function handleSelect(key, optionValue) {
    onChange({ ...value, [key]: optionValue === value[key] ? '' : optionValue })
  }

  function clearAll() {
    const reset = {}
    filters.forEach((f) => {
      if (f.type === 'daterange') { reset[f.fromKey] = ''; reset[f.toKey] = '' }
      else reset[f.key] = ''
    })
    onChange(reset)
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {filters.map((filter) => {
        if (filter.type === 'daterange') {
          return <DateRangeFilter key={filter.key} filter={filter} value={value} onChange={onChange} />
        }
        const active = value[filter.key]
        const activeLabel = filter.options.find((o) => o.value === active)?.label

        return (
          <Popover key={filter.key}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors',
                  active
                    ? 'border-(--brand-primary) bg-(--brand-soft) text-[hsl(var(--foreground))]'
                    : 'border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]'
                )}
              >
                {filter.label}
                {active && (
                  <span className="rounded-full bg-(--brand-primary) px-1.5 text-[10px] font-bold text-(--brand-primary-foreground)">
                    {activeLabel}
                  </span>
                )}
                <ChevronDown className="h-3 w-3 opacity-60" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-44 p-1" align="start">
              {filter.options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handleSelect(filter.key, option.value)}
                  className={cn(
                    'flex w-full items-center rounded-lg px-3 py-2 text-left text-sm transition-colors',
                    value[filter.key] === option.value
                      ? 'bg-(--brand-soft) font-medium text-[hsl(var(--foreground))]'
                      : 'text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]'
                  )}
                >
                  {option.label}
                </button>
              ))}
            </PopoverContent>
          </Popover>
        )
      })}

      {activeCount > 0 && (
        <button
          type="button"
          onClick={clearAll}
          className="inline-flex h-8 items-center gap-1 rounded-full px-3 text-xs font-medium text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
        >
          <X className="h-3.5 w-3.5" />
          Limpiar filtros
        </button>
      )}
    </div>
  )
}
