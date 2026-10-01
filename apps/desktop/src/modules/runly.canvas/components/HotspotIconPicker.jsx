import { useDeferredValue, useMemo, useState } from 'react'
import {
  Button, DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
  SearchInput, cn,
} from '@runly/ui'
import { ChevronDown, ListFilter, X } from 'lucide-react'
import { allIconNames } from '../engine/icons.js'
import { ICON_CATEGORIES, iconLabel, searchCurated } from '../lib/iconLibrary.js'
import { IconGlyph } from './IconGlyph.jsx'

const PAGE = 120
const GRID = 'grid grid-cols-[repeat(auto-fill,minmax(2.75rem,1fr))] gap-1.5'

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

// Checkable category menu: tick several categories at once, or "Todos los
// iconos" for the full lucide set. The menu stays open while ticking.
function CategoryFilter({ selected, showAll, total, onToggle, onShowAll, onClear }) {
  const keepOpen = (event) => event.preventDefault()
  const active = showAll || selected.size > 0
  let summary = 'Todas las categorias'
  if (showAll) summary = `Todos los iconos (${total})`
  else if (selected.size === 1) summary = [...selected][0]
  else if (selected.size > 1) summary = `${selected.size} categorias`
  return (
    <div className="flex items-center gap-1.5">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" className={cn('h-11 min-w-0 flex-1 justify-between gap-2 px-3 sm:h-9', active && 'border-primary/60')}>
            <span className="flex min-w-0 items-center gap-2">
              <ListFilter className="shrink-0" />
              <span className="truncate">{summary}</span>
            </span>
            <ChevronDown className="shrink-0 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-[min(60dvh,420px)] w-[min(20rem,calc(100vw-2rem))] overflow-y-auto">
          <DropdownMenuCheckboxItem checked={showAll} onCheckedChange={onShowAll} onSelect={keepOpen} className="min-h-10">
            <span className="flex-1">Todos los iconos</span>
            <span className="text-xs tabular-nums text-[hsl(var(--muted-foreground))]">{total}</span>
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[hsl(var(--muted-foreground))]">Recomendados por categoria</DropdownMenuLabel>
          {ICON_CATEGORIES.map((category) => (
            <DropdownMenuCheckboxItem
              key={category.label}
              checked={!showAll && selected.has(category.label)}
              onCheckedChange={() => onToggle(category.label)}
              onSelect={keepOpen}
              className="min-h-10"
            >
              <span className="flex-1">{category.label}</span>
              <span className="text-xs tabular-nums text-[hsl(var(--muted-foreground))]">{category.items.length}</span>
            </DropdownMenuCheckboxItem>
          ))}
          {active ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onClear} className="min-h-10 justify-center font-medium">Quitar filtro</DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {active ? (
        <Button type="button" size="icon" variant="ghost" aria-label="Quitar filtro de categorias" onClick={onClear} className="h-11 w-11 shrink-0 sm:h-9 sm:w-9"><X /></Button>
      ) : null}
    </div>
  )
}

function Group({ title, children }) {
  return (
    <section className="mb-3 last:mb-0">
      {title ? (
        <h4 className="sticky top-0 z-1 mb-1.5 bg-[hsl(var(--card))] py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[hsl(var(--muted-foreground))]">{title}</h4>
      ) : null}
      {children}
    </section>
  )
}

function useIconResults({ term, selected, showAll, allNames }) {
  return useMemo(() => {
    const categories = selected.size ? ICON_CATEGORIES.filter((category) => selected.has(category.label)) : ICON_CATEGORIES
    const normalized = term.toLowerCase().replace(/\s+/g, '-')
    if (showAll) {
      const curatedMatches = term ? searchCurated(term) : []
      const known = new Set(curatedMatches.map((item) => item.name))
      return {
        groups: curatedMatches.length ? [{ title: 'Recomendados', items: curatedMatches }] : [],
        extra: allNames.filter((name) => (!term || name.includes(normalized)) && !known.has(name)),
      }
    }
    if (term) {
      const matches = categories.flatMap((category) => searchCurated(term, category.label))
      const unique = [...new Map(matches.map((item) => [item.name, item])).values()]
      const known = new Set(unique.map((item) => item.name))
      return {
        groups: unique.length ? [{ title: null, items: unique }] : [],
        // Without a category filter, also offer matching names from the full set.
        extra: selected.size ? [] : allNames.filter((name) => name.includes(normalized) && !known.has(name)),
      }
    }
    return { groups: categories.map((category) => ({ title: category.label, items: category.items })), extra: [] }
  }, [term, selected, showAll, allNames])
}

// Inline icon library for hotspot pins: Spanish search over the curated
// catalog, a checkable category filter and the full lucide set.
export function HotspotIconPicker({ value, color = '#ef4444', onChange, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(() => new Set())
  const [showAll, setShowAll] = useState(false)
  const [limit, setLimit] = useState(PAGE)
  const term = useDeferredValue(query.trim())
  const allNames = useMemo(() => allIconNames(), [])
  const { groups, extra } = useIconResults({ term, selected, showAll, allNames })

  const toggleCategory = (label) => {
    setShowAll(false); setLimit(PAGE)
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(label)) next.delete(label); else next.add(label)
      return next
    })
  }
  const clearFilter = () => { setSelected(new Set()); setShowAll(false); setLimit(PAGE) }
  const choose = (name) => { onChange(name); setOpen(false); setQuery('') }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white shadow-sm sm:h-10 sm:w-10"
          style={{ backgroundColor: color }}
          title={value ? iconLabel(value) : 'Sin icono'}
          role="img"
          aria-label={value ? `Icono actual: ${iconLabel(value)}` : 'Sin icono'}
        >
          {value ? <IconGlyph name={value} className="h-5 w-5" strokeWidth={2.25} /> : <span className="h-3 w-3 rounded-full bg-white" />}
        </span>
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen((current) => !current)} aria-expanded={open} className="h-11 flex-1 justify-between sm:h-9">
          {open ? 'Cerrar' : value ? 'Cambiar icono' : 'Elegir icono'}<ChevronDown className={cn('transition-transform', open && 'rotate-180')} />
        </Button>
        {value ? (
          <Button type="button" size="icon" variant="ghost" aria-label="Quitar icono" title="Quitar icono" onClick={() => onChange(null)} className="h-11 w-11 shrink-0 sm:h-9 sm:w-9"><X /></Button>
        ) : null}
      </div>

      {open ? (
        <div className="space-y-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-2.5">
          <SearchInput value={query} onChange={(event) => { setQuery(event.target.value); setLimit(PAGE) }} onClear={() => setQuery('')} placeholder="Buscar: extintor, camara, agua, wifi…" />
          <CategoryFilter
            selected={selected}
            showAll={showAll}
            total={allNames.length}
            onToggle={toggleCategory}
            onShowAll={(checked) => { setShowAll(checked); setSelected(new Set()); setLimit(PAGE) }}
            onClear={clearFilter}
          />
          <div className="max-h-72 overflow-y-auto overscroll-contain pr-0.5" role="radiogroup" aria-label="Iconos">
            {groups.map((group) => (
              <Group key={group.title ?? 'results'} title={group.title}>
                <div className={GRID}>
                  {group.items.map((item) => <IconButton key={item.name} name={item.name} label={item.label} active={value === item.name} color={color} onSelect={choose} />)}
                </div>
              </Group>
            ))}
            {extra.length ? (
              <Group title={groups.length ? 'Mas iconos (nombres en ingles)' : null}>
                <div className={GRID}>
                  {extra.slice(0, limit).map((name) => <IconButton key={name} name={name} label={name.replace(/-/g, ' ')} active={value === name} color={color} onSelect={choose} />)}
                </div>
                {extra.length > limit ? (
                  <Button type="button" variant="ghost" size="sm" className="mt-2 w-full" onClick={() => setLimit((current) => current + PAGE)}>
                    Mostrar mas ({extra.length - limit} restantes)
                  </Button>
                ) : null}
              </Group>
            ) : null}
            {!groups.length && !extra.length ? (
              <p className="px-1 py-6 text-center text-sm text-[hsl(var(--muted-foreground))]">
                Sin iconos para «{term}»{selected.size ? ' en las categorias elegidas' : ''}. Prueba otra palabra (luz, puerta, caja), el nombre en ingles o quita el filtro.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
