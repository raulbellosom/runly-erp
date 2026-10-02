import { useState } from 'react'
import { Badge, Button, SelectField, Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle, useIsMobile } from '@runly/ui'
import { ListFilter, X } from 'lucide-react'
import { useCanvasTemplates } from '../hooks/useCanvasData.js'
import { activeFilterCount } from '../lib/boardFilters.js'

const ACCESS_OPTIONS = [
  { value: 'all', label: 'Todos' },
  { value: 'mine', label: 'Míos' },
  { value: 'shared', label: 'Compartidos conmigo' },
]
const UPDATED_OPTIONS = [
  { value: 'any', label: 'Cualquier fecha' },
  { value: 'today', label: 'Hoy' },
  { value: '7d', label: 'Últimos 7 días' },
  { value: '30d', label: 'Últimos 30 días' },
]
const SORT_OPTIONS = [
  { value: 'recent', label: 'Recientes' },
  { value: 'name', label: 'Nombre A-Z' },
  { value: 'oldest', label: 'Más antiguos' },
]

// Shared between the desktop row and the mobile Sheet — the exact same controls either way.
function FilterControls({ filters, templates, onChange }) {
  const templateOptions = [{ value: 'all', label: 'Todas las plantillas' }, ...templates.map((template) => ({ value: template.key, label: template.label }))]
  return (
    <>
      <SelectField label="Plantilla" value={filters.templates[0] ?? 'all'} options={templateOptions} onValueChange={(value) => onChange({ ...filters, templates: value === 'all' ? [] : [value] })} />
      <SelectField label="Acceso" value={filters.access} options={ACCESS_OPTIONS} onValueChange={(access) => onChange({ ...filters, access })} />
      <SelectField label="Actualizado" value={filters.updated} options={UPDATED_OPTIONS} onValueChange={(updated) => onChange({ ...filters, updated })} />
      <SelectField label="Orden" value={filters.sort} options={SORT_OPTIONS} onValueChange={(sort) => onChange({ ...filters, sort })} />
    </>
  )
}

export function BoardFilters({ filters, onChange, onClear }) {
  const isMobile = useIsMobile()
  const templates = useCanvasTemplates().data ?? []
  const [open, setOpen] = useState(false)
  const count = activeFilterCount(filters)
  const clearButton = (variant) => (
    <Button type="button" variant={variant} onClick={onClear}><X className="h-4 w-4" />Limpiar filtros</Button>
  )

  if (isMobile) {
    return (
      <>
        <Button type="button" variant="outline" onClick={() => setOpen(true)} className="shrink-0">
          <ListFilter className="h-4 w-4" />Filtros{count > 0 ? <Badge variant="secondary" className="ml-1">{count}</Badge> : null}
        </Button>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="right" className="gap-0 p-0">
            <SheetHeader className="shrink-0 border-b border-[hsl(var(--border))] px-4 py-3">
              <SheetTitle>Filtros</SheetTitle>
            </SheetHeader>
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
              <FilterControls filters={filters} templates={templates} onChange={onChange} />
            </div>
            {count > 0 ? (
              <SheetFooter className="shrink-0 border-t border-[hsl(var(--border))] px-4 py-3">
                {clearButton('outline')}
              </SheetFooter>
            ) : null}
          </SheetContent>
        </Sheet>
      </>
    )
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <FilterControls filters={filters} templates={templates} onChange={onChange} />
      {count > 0 ? clearButton('ghost') : null}
    </div>
  )
}
