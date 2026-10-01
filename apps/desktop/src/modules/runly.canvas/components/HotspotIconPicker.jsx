import { useDeferredValue, useMemo, useState } from 'react'
import { Button, SearchInput, cn } from '@runly/ui'
import { ChevronDown, X } from 'lucide-react'
import { allIconNames } from '../engine/icons.js'
import { CURATED_ICONS, ICON_CATEGORIES, iconLabel, searchCurated } from '../lib/iconLibrary.js'
import { IconGlyph } from './IconGlyph.jsx'

const PAGE = 120
const ALL = '__all__'

function IconButton({ name, label, active, color, onSelect }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      aria-label={label}
      title={label}
      onClick={() => onSelect(name)}
      className={cn(
        'flex aspect-square w-full cursor-pointer items-center justify-center rounded-lg border transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
        active ? 'border-transparent text-white' : 'border-[hsl(var(--border))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted)/0.7)]',
      )}
      style={active ? { backgroundColor: color } : undefined}
    >
      <IconGlyph name={name} className="h-5 w-5" />
    </button>
  )
}

// Inline icon library for hotspot pins: Spanish search over the curated
// catalog, category chips, and every lucide icon under "Todos".
export function HotspotIconPicker({ value, color = '#ef4444', onChange, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState(ICON_CATEGORIES[0].label)
  const [limit, setLimit] = useState(PAGE)
  const term = useDeferredValue(query.trim())
  const allNames = useMemo(() => allIconNames(), [])

  const { curated, extra } = useMemo(() => {
    if (term) {
      const curatedMatches = searchCurated(term)
      const known = new Set(curatedMatches.map((item) => item.name))
      const normalized = term.toLowerCase().replace(/\s+/g, '-')
      return { curated: curatedMatches, extra: allNames.filter((name) => name.includes(normalized) && !known.has(name)) }
    }
    if (category === ALL) return { curated: [], extra: allNames }
    return { curated: searchCurated('', category), extra: [] }
  }, [term, category, allNames])

  const choose = (name) => { onChange(name); setOpen(false); setQuery('') }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white shadow-sm sm:h-10 sm:w-10" style={{ backgroundColor: color }} aria-hidden>
          {value ? <IconGlyph name={value} className="h-5 w-5" strokeWidth={2.25} /> : <span className="h-3 w-3 rounded-full bg-white" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{value ? iconLabel(value) : 'Sin icono (punto)'}</p>
          <p className="text-xs text-[hsl(var(--muted-foreground))]">{CURATED_ICONS.length} recomendados · {allNames.length} en total</p>
        </div>
        {value ? (
          <Button type="button" size="icon" variant="ghost" aria-label="Quitar icono" onClick={() => onChange(null)} className="h-11 w-11 sm:h-9 sm:w-9"><X /></Button>
        ) : null}
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen((current) => !current)} aria-expanded={open} className="h-11 sm:h-9">
          {open ? 'Cerrar' : 'Elegir'}<ChevronDown className={cn('transition-transform', open && 'rotate-180')} />
        </Button>
      </div>

      {open ? (
        <div className="space-y-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.3)] p-2.5">
          <SearchInput value={query} onChange={(event) => { setQuery(event.target.value); setLimit(PAGE) }} onClear={() => setQuery('')} placeholder="Buscar: extintor, camara, agua, wifi…" />
          {!term ? (
            <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Categorias de iconos">
              {[...ICON_CATEGORIES.map((item) => item.label), ALL].map((label) => (
                <button
                  key={label}
                  type="button"
                  role="tab"
                  aria-selected={category === label}
                  onClick={() => { setCategory(label); setLimit(PAGE) }}
                  className={cn(
                    'h-9 shrink-0 cursor-pointer whitespace-nowrap rounded-full border px-3 text-xs font-medium transition-colors sm:h-8',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
                    category === label ? 'border-transparent bg-[hsl(var(--foreground))] text-[hsl(var(--background))]' : 'border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]',
                  )}
                >
                  {label === ALL ? `Todos (${allNames.length})` : label}
                </button>
              ))}
            </div>
          ) : null}
          <div className="max-h-72 overflow-y-auto overscroll-contain pr-0.5" role="radiogroup" aria-label="Iconos">
            {curated.length ? (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(2.75rem,1fr))] gap-1.5">
                {curated.map((item) => <IconButton key={item.name} name={item.name} label={item.label} active={value === item.name} color={color} onSelect={choose} />)}
              </div>
            ) : null}
            {extra.length ? (
              <>
                {term && curated.length ? <p className="mb-1.5 mt-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-[hsl(var(--muted-foreground))]">Mas iconos (nombres en ingles)</p> : null}
                <div className="grid grid-cols-[repeat(auto-fill,minmax(2.75rem,1fr))] gap-1.5">
                  {extra.slice(0, limit).map((name) => <IconButton key={name} name={name} label={name.replace(/-/g, ' ')} active={value === name} color={color} onSelect={choose} />)}
                </div>
                {extra.length > limit ? (
                  <Button type="button" variant="ghost" size="sm" className="mt-2 w-full" onClick={() => setLimit((current) => current + PAGE)}>
                    Mostrar mas ({extra.length - limit} restantes)
                  </Button>
                ) : null}
              </>
            ) : null}
            {!curated.length && !extra.length ? (
              <p className="px-1 py-6 text-center text-sm text-[hsl(var(--muted-foreground))]">Sin iconos para «{term}». Prueba otra palabra (por ejemplo: luz, puerta, caja) o el nombre en ingles.</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
