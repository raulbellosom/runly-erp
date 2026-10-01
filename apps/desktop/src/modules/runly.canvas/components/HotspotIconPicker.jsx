import { useDeferredValue, useMemo, useState } from 'react'
import {
  Button, Dialog, DialogContent, DialogHeader, DialogTitle, DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, Popover, PopoverContent, PopoverTrigger, SearchInput, cn, useIsMobile,
} from '@runly/ui'
import { ChevronDown, ListFilter, X } from 'lucide-react'
import { allIconNames } from '../engine/icons.js'
import { ICON_CATEGORIES, iconLabel, searchCurated } from '../lib/iconLibrary.js'
import { IconGlyph } from './IconGlyph.jsx'

const PAGE = 120
// Same look as @runly/ui text fields (FIELD_BASE + FIELD_NORMAL).
const FIELD = 'w-full rounded-lg border border-input bg-card px-3.5 text-foreground glass-subtle outline-none transition-all duration-150 hover:border-muted-foreground/50 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20'
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

// Search + checkable category filter + icon grid. Shared by the desktop
// popover and the mobile bottom sheet.
function IconLibraryPanel({ value, color, onChoose, gridClassName }) {
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

  return (
    <div className="space-y-2">
      <SearchInput value={query} onChange={(event) => { setQuery(event.target.value); setLimit(PAGE) }} onClear={() => setQuery('')} placeholder="Buscar: extintor, camara, agua, wifi…" />
      <CategoryFilter
        selected={selected}
        showAll={showAll}
        total={allNames.length}
        onToggle={toggleCategory}
        onShowAll={(checked) => { setShowAll(checked); setSelected(new Set()); setLimit(PAGE) }}
        onClear={clearFilter}
      />
      <div className={cn('overflow-y-auto overscroll-contain pr-0.5', gridClassName)} role="radiogroup" aria-label="Iconos">
        {groups.map((group) => (
          <Group key={group.title ?? 'results'} title={group.title}>
            <div className={GRID}>
              {group.items.map((item) => <IconButton key={item.name} name={item.name} label={item.label} active={value === item.name} color={color} onSelect={onChoose} />)}
            </div>
          </Group>
        ))}
        {extra.length ? (
          <Group title={groups.length ? 'Mas iconos (nombres en ingles)' : null}>
            <div className={GRID}>
              {extra.slice(0, limit).map((name) => <IconButton key={name} name={name} label={name.replace(/-/g, ' ')} active={value === name} color={color} onSelect={onChoose} />)}
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
  )
}

// Combobox-style field: the trigger looks like a select (pin preview, icon
// name, chevron); the library opens in a popover on desktop and in a bottom
// sheet on phones, so the surrounding form never shifts.
export function HotspotIconPicker({ value, color = '#ef4444', onChange }) {
  const [open, setOpen] = useState(false)
  const isMobile = useIsMobile()
  const choose = (name) => { onChange(name); setOpen(false) }
  const label = value ? iconLabel(value) : 'Sin icono'

  const trigger = (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={`Icono del pin: ${label}. Cambiar`}
      onClick={isMobile ? () => setOpen(true) : undefined}
      className={cn(FIELD, 'flex min-h-11 cursor-pointer items-center gap-2.5 pl-1.5 text-left sm:min-h-10')}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white shadow-sm" style={{ backgroundColor: color }} aria-hidden>
        {value ? <IconGlyph name={value} className="h-4 w-4" strokeWidth={2.25} /> : <span className="h-2.5 w-2.5 rounded-full bg-white" />}
      </span>
      <span className={cn('min-w-0 flex-1 truncate text-sm', !value && 'text-[hsl(var(--muted-foreground))]')}>{value ? label : 'Elegir icono…'}</span>
      <ChevronDown className={cn('h-4 w-4 shrink-0 text-[hsl(var(--muted-foreground))] transition-transform', open && 'rotate-180')} aria-hidden />
    </button>
  )

  return (
    <div className="flex items-center gap-1.5">
      <div className="min-w-0 flex-1">
        {isMobile ? (
          <>
            {trigger}
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogContent className="gap-3 p-4">
                <DialogHeader><DialogTitle>Icono del pin</DialogTitle></DialogHeader>
                <IconLibraryPanel value={value} color={color} onChoose={choose} gridClassName="max-h-[45dvh]" />
              </DialogContent>
            </Dialog>
          </>
        ) : (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>{trigger}</PopoverTrigger>
            <PopoverContent align="start" sideOffset={6} className="w-[min(24rem,calc(100vw-2rem))] border border-[hsl(var(--border))] p-3" style={{ background: 'hsl(var(--card))' }}>
              <IconLibraryPanel value={value} color={color} onChoose={choose} gridClassName="max-h-72" />
            </PopoverContent>
          </Popover>
        )}
      </div>
      {value ? (
        <Button type="button" size="icon" variant="ghost" aria-label="Quitar icono" title="Quitar icono" onClick={() => onChange(null)} className="h-11 w-11 shrink-0 sm:h-10 sm:w-10"><X /></Button>
      ) : null}
    </div>
  )
}
