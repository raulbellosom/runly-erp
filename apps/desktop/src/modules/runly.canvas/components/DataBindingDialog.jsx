import { useEffect, useMemo, useState } from 'react'
import {
  Button, Combobox, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, EmptyState, ErrorState, SelectField, Skeleton,
} from '@runly/ui'
import { Database, Loader2 } from 'lucide-react'
import { useDataSources, useDataSourceSearch } from '../hooks/useCanvasData.js'

function useDebounced(value, delay = 250) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(handle)
  }, [value, delay])
  return debounced
}

const COPY = {
  connect: { title: 'Conectar a datos', action: 'Conectar' },
  insert: { title: 'Insertar datos', action: 'Insertar' },
}

// Dialog shared by "Conectar a datos" (inspector, on an existing shape) and
// "Insertar datos" (toolbar, creates a new rectangle already connected).
export function DataBindingDialog({ open, mode = 'connect', onOpenChange, onConfirm, pending = false }) {
  const sources = useDataSources(open)
  const available = useMemo(() => (sources.data ?? []).filter((item) => item.installed && item.allowed), [sources.data])
  const [source, setSource] = useState(null)
  const [recordId, setRecordId] = useState(null)
  const [search, setSearch] = useState('')
  const term = useDebounced(search)
  const results = useDataSourceSearch(source, term)
  const options = (results.data ?? []).map((row) => ({ value: row.id, label: row.title, description: row.subtitle ?? undefined }))
  const picked = (results.data ?? []).find((row) => row.id === recordId) ?? null

  // Reset the pick (not the source) whenever the dialog reopens.
  useEffect(() => { if (open) { setRecordId(null); setSearch('') } }, [open])
  useEffect(() => { if (!source && available.length) setSource(available[0].key) }, [source, available])

  const { title, action } = COPY[mode] ?? COPY.connect

  function confirm() {
    if (!source || !picked) return
    onConfirm({ source, id: picked.id }, { title: picked.title, subtitle: picked.subtitle ?? null })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent scrollable size="md" className="gap-0">
        <DialogHeader className="mb-0 border-b border-[hsl(var(--border))] pb-4">
          <DialogTitle className="flex items-center gap-2"><Database className="h-4 w-4" />{title}</DialogTitle>
          <DialogDescription>Elige un registro de Runly. El objeto mostrará su información y estado actualizados.</DialogDescription>
        </DialogHeader>
        <div className="-mx-1 min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-1 py-5">
          {sources.isLoading ? (
            <Skeleton className="h-24 rounded-xl" />
          ) : sources.isError ? (
            <ErrorState title="No se pudieron cargar las fuentes de datos" onRetry={() => sources.refetch()} />
          ) : !available.length ? (
            <EmptyState title="No tienes fuentes de datos disponibles" />
          ) : (
            <>
              <SelectField
                label="Fuente"
                options={available.map((item) => ({ value: item.key, label: item.label }))}
                value={source}
                onValueChange={(value) => { setSource(value); setRecordId(null); setSearch('') }}
              />
              <Combobox
                label="Registro"
                placeholder="Buscar…"
                searchPlaceholder="Buscar…"
                options={options}
                value={recordId}
                onChange={setRecordId}
                onSearchChange={setSearch}
                filter={false}
                loading={results.isFetching}
                loadError={results.isError ? 'No se pudo buscar' : null}
                onRetry={() => results.refetch()}
                emptyText="Sin resultados"
                disabled={pending}
              />
            </>
          )}
        </div>
        <DialogFooter className="mt-0 shrink-0 flex-row border-t border-[hsl(var(--border))] pt-4">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="flex-1 sm:flex-none">Cancelar</Button>
          <Button type="button" disabled={!recordId || pending} onClick={confirm} className="flex-1 sm:flex-none">
            {pending ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : null}{action}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
