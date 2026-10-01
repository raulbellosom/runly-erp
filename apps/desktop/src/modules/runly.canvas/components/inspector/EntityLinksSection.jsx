import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Combobox, SelectField } from '@runly/ui'
import { ExternalLink, Link2, Loader2, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { useCreateEntityLink, useRecordSearch, useRemoveEntityLink } from '../../hooks/useCanvasData.js'
import { RECORD_TYPES, recordTypeOf } from '../../lib/recordTypes.js'
import { Section } from './fields.jsx'

function useDebounced(value, delay = 250) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(handle)
  }, [value, delay])
  return debounced
}

function RecordPicker({ boardId, targetType, targetId, onDone }) {
  const [type, setType] = useState(RECORD_TYPES[0].type)
  const [search, setSearch] = useState('')
  const term = useDebounced(search)
  const results = useRecordSearch(type, term)
  const create = useCreateEntityLink(boardId)
  const meta = RECORD_TYPES.find((item) => item.type === type)
  const options = (results.data?.data ?? results.data ?? []).map((row) => ({ value: row.id, label: row.title, description: row.subtitle ?? undefined }))

  async function link(entityId) {
    if (!entityId) return
    try {
      await create.mutateAsync({ targetType, targetId, moduleKey: meta.moduleKey, entityType: meta.entityType, entityId })
      toast.success('Registro vinculado')
      onDone()
    } catch (error) { toast.error(error.message) }
  }

  return (
    <div className="space-y-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.35)] p-2.5">
      <SelectField
        label="Tipo de registro"
        options={RECORD_TYPES.map((item) => ({ value: item.type, label: item.label, icon: item.icon }))}
        value={type}
        onValueChange={(value) => { setType(value); setSearch('') }}
      />
      <Combobox
        label="Registro"
        placeholder={`Buscar ${meta.label.toLowerCase()}…`}
        searchPlaceholder="Escribe para buscar…"
        options={options}
        value={null}
        onChange={link}
        onSearchChange={setSearch}
        filter={false}
        loading={results.isFetching}
        loadError={results.isError ? 'No se pudo buscar' : null}
        onRetry={() => results.refetch()}
        emptyText="Sin coincidencias"
        disabled={create.isPending}
      />
      <div className="flex justify-end">
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>Cancelar</Button>
      </div>
    </div>
  )
}

export function EntityLinksSection({ boardId, targetType, targetId, links, readOnly = false }) {
  const navigate = useNavigate()
  const [adding, setAdding] = useState(false)
  const remove = useRemoveEntityLink(boardId)
  const own = links.filter((link) => link.targetType === targetType && link.targetId === targetId)

  return (
    <Section
      title="Registros vinculados"
      action={!adding && !readOnly ? (
        <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(true)} className="h-8 gap-1 px-2 text-xs">
          <Plus className="h-3.5 w-3.5" />Vincular
        </Button>
      ) : null}
    >
      {adding ? <RecordPicker boardId={boardId} targetType={targetType} targetId={targetId} onDone={() => setAdding(false)} /> : null}
      {own.length ? (
        <ul className="space-y-1">
          {own.map((link) => {
            const meta = recordTypeOf(link), Icon = meta?.icon ?? Link2, resolved = link.metadata?.resolved ?? {}
            const url = typeof resolved.url === 'string' && resolved.url.startsWith('/') ? resolved.url : null
            return (
              <li key={link.id} className="group flex items-center gap-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] py-1.5 pl-2.5 pr-1">
                <Icon className="h-4 w-4 shrink-0 text-[hsl(var(--muted-foreground))]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{resolved.title ?? 'Registro'}</span>
                  <span className="block truncate text-xs text-[hsl(var(--muted-foreground))]">{meta?.label}{resolved.subtitle ? ` · ${resolved.subtitle}` : ''}</span>
                </span>
                {url ? (
                  <Button type="button" size="icon" variant="ghost" aria-label="Abrir registro" onClick={() => navigate(url)} className="h-9 w-9 sm:h-7 sm:w-7">
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Button>
                ) : null}
                {readOnly ? null : <Button type="button" size="icon" variant="ghost" aria-label="Quitar vínculo" disabled={remove.isPending} onClick={() => remove.mutate(link.id, { onError: (error) => toast.error(error.message) })} className="h-9 w-9 hover:text-destructive sm:h-7 sm:w-7">
                  {remove.isPending && remove.variables === link.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                </Button>}
              </li>
            )
          })}
        </ul>
      ) : readOnly ? (
        <p className="px-0.5 text-xs text-[hsl(var(--muted-foreground))]">Sin registros vinculados.</p>
      ) : !adding ? (
        <p className="px-0.5 text-xs text-[hsl(var(--muted-foreground))]">Conecta este elemento con un contacto, empleado, vehículo, artículo u otro registro de Runly.</p>
      ) : null}
    </Section>
  )
}
