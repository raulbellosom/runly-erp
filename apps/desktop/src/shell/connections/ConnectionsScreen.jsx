import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger, Badge, Button, CheckboxField, DataTable,
  EmptyState, ErrorState, IconGlyph, PageHeader, SearchInput, Skeleton, SwitchField,
} from '@runly/ui'
import { AlertTriangle, Plug, Save } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../auth/AuthProvider'
import { useActiveCompany } from '../../company/ActiveCompanyProvider'
import { runly } from '../../lib/runly'

// "Conexiones" of a core module (spec 2026-10-03-rme3-module-platform-v2 §8.2):
// one collapsible row per connected module — collapsed it shows what matters
// at a glance (module, kind, state, how many fields per use); expanded it
// shows the per-field surface checkboxes. Pending / needs-review rows open
// by default because they need the admin's attention.

const SURFACES = [
  { key: 'form', label: 'Formulario' },
  { key: 'detail', label: 'Detalle' },
  { key: 'column', label: 'Columna' },
  { key: 'search', label: 'Búsqueda' },
]
const POLICY_LABEL = {
  cascade: 'Al eliminar el registro se eliminan estos datos.',
  setNull: 'Al eliminar el registro, estos datos quedan sin vínculo.',
  restrict: 'No se podrá eliminar un registro que tenga estos datos.',
}
const kebab = (name) => String(name).replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/([A-Za-z])(\d)/g, '$1-$2').toLowerCase()

function surfaceCounts(config) {
  return SURFACES.map((surface) => ({ ...surface, count: (config ?? []).filter((entry) => entry[surface.key]).length }))
}

function ConnectionFields({ connection, config, setConfig }) {
  const toggle = (field, surface, checked) => setConfig((current) => current.map((entry) => (
    entry.field === field ? { ...entry, [surface]: checked } : entry
  )))
  const rows = connection.offered.map((offered) => ({ ...offered, entry: config.find((item) => item.field === offered.field) ?? {} }))
  const columns = [
    { accessorKey: 'label', header: 'Campo' },
    ...SURFACES.map((surface) => ({
      id: surface.key,
      header: surface.label,
      enableSorting: false,
      cell: ({ row }) => (row.original[surface.key] ? (
        <CheckboxField
          id={`${connection.id}-${row.original.field}-${surface.key}`}
          checked={Boolean(row.original.entry[surface.key])}
          onChange={(e) => toggle(row.original.field, surface.key, e.target.checked)}
        />
      ) : <span className="text-muted-foreground/50" title="El módulo no ofrece este uso">—</span>),
    })),
  ]
  return (
    <DataTable
      columns={columns}
      data={rows}
      getRowId={(row) => row.field}
      showToolbar={false}
      showPagination={false}
      pageSize={100}
      emptyTitle="El módulo no ofrece campos"
    />
  )
}

function ConnectionItem({ connection, onSave, saving }) {
  const [config, setConfig] = useState(connection.fieldConfig ?? [])
  useEffect(() => setConfig(connection.fieldConfig ?? []), [connection.fieldConfig])
  const dirty = JSON.stringify(config) !== JSON.stringify(connection.fieldConfig ?? [])
  const pending = connection.status === 'pending'
  const active = connection.status === 'active'

  return (
    <AccordionItem value={connection.id} className="bg-card">
      <div className="flex items-center">
        <AccordionTrigger className="min-w-0 flex-1 px-4 py-3 hover:bg-muted/60">
          <span className="flex min-w-0 flex-1 flex-col gap-1 text-left">
            <span className="flex flex-wrap items-center gap-2">
              {connection.moduleIcon ? <IconGlyph name={kebab(connection.moduleIcon)} className="h-4 w-4 shrink-0 text-primary" /> : <Plug className="h-4 w-4 shrink-0 text-primary" />}
              <span className="font-semibold text-foreground">{connection.label}</span>
              <span className="text-xs font-normal text-muted-foreground">{connection.moduleName}</span>
              <Badge variant="secondary">{connection.kind === 'fields' ? 'Campos' : 'Registros relacionados'}</Badge>
              {pending && <Badge variant="warning">Pendiente</Badge>}
              {connection.needsReview && <Badge variant="warning">Revisar</Badge>}
              {!connection.moduleAvailable && <Badge variant="outline">Módulo inactivo</Badge>}
              {dirty && <Badge variant="outline">Sin guardar</Badge>}
            </span>
            <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs font-normal text-muted-foreground">
              {surfaceCounts(config).map((surface) => (
                <span key={surface.key} className={surface.count ? '' : 'opacity-50'}>
                  {surface.label}: {surface.count}
                </span>
              ))}
            </span>
          </span>
        </AccordionTrigger>
        <div className="shrink-0 px-4">
          <SwitchField
            label={active ? 'Activa' : 'Inactiva'}
            checked={active}
            disabled={saving}
            onChange={(checked) => onSave({ status: checked ? 'active' : 'disabled' })}
          />
        </div>
      </div>
      <AccordionContent className="space-y-4 px-4 pb-4">
        <p className="text-sm text-muted-foreground">De {connection.moduleName}. {POLICY_LABEL[connection.onTargetDelete]}</p>
        {connection.needsReview && (
          <p className="flex items-center gap-2 rounded-xl bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
            <AlertTriangle className="h-4 w-4 shrink-0" /> El módulo cambió los campos que ofrece. Revisa la configuración y guárdala.
          </p>
        )}
        <ConnectionFields connection={connection} config={config} setConfig={setConfig} />
        <div className="flex flex-wrap justify-end gap-2">
          {dirty && <Button variant="ghost" disabled={saving} onClick={() => setConfig(connection.fieldConfig ?? [])}>Descartar</Button>}
          {pending && (
            <Button variant="outline" disabled={saving} onClick={() => onSave({ status: 'active', fieldConfig: config })}>
              Revisar y activar
            </Button>
          )}
          <Button disabled={!dirty || saving} onClick={() => onSave({ fieldConfig: config })}>
            <Save /> Guardar campos
          </Button>
        </div>
      </AccordionContent>
    </AccordionItem>
  )
}

export function ConnectionsScreen({ targetType, title = 'Conexiones', description }) {
  const { session } = useAuth()
  const { activeCompanyId } = useActiveCompany()
  const token = session?.access_token
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(null)
  const { data = [], isLoading, error, refetch } = useQuery({
    queryKey: ['connections', 'admin', targetType, activeCompanyId],
    queryFn: async () => (await runly.connections.list(targetType, token))?.data ?? [],
    enabled: Boolean(token),
    // Connected data changes from other modules, which cannot invalidate
    // this cache: always refetch when the screen opens.
    staleTime: 0,
    refetchOnMount: 'always',
  })
  // Rows needing attention start open; afterwards the user decides.
  useEffect(() => {
    if (open === null && data.length) setOpen(data.filter((c) => c.status === 'pending' || c.needsReview).map((c) => c.id))
  }, [data, open])

  const save = useMutation({
    mutationFn: ({ id, patch }) => runly.connections.update(id, patch, token),
    onSuccess: () => {
      toast.success('Conexión actualizada.')
      queryClient.invalidateQueries({ queryKey: ['connections'] })
    },
    onError: (err) => toast.error(err?.message ?? 'No se pudo guardar la conexión.'),
  })

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    return term ? data.filter((c) => `${c.label} ${c.moduleName}`.toLowerCase().includes(term)) : data
  }, [data, search])
  const activeCount = data.filter((c) => c.status === 'active').length
  const pendingCount = data.filter((c) => c.status === 'pending').length

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 p-4 md:p-6">
      <PageHeader
        title={title}
        description={description ?? 'Módulos que agregan datos a estos registros. Elige cuáles se usan y qué campos se muestran, editan y buscan.'}
      />
      {isLoading ? <Skeleton className="h-32 w-full" /> : error ? (
        <ErrorState description={error.message} onRetry={refetch} />
      ) : !data.length ? (
        <EmptyState icon={Plug} title="Sin conexiones" description="Cuando instales un módulo que se conecte aquí, aparecerá en esta lista para que lo actives." />
      ) : (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              {data.length} {data.length === 1 ? 'conexión' : 'conexiones'} · {activeCount} {activeCount === 1 ? 'activa' : 'activas'}
              {pendingCount ? ` · ${pendingCount} ${pendingCount === 1 ? 'pendiente' : 'pendientes'}` : ''}
            </p>
            {data.length > 3 && (
              <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} onClear={() => setSearch('')} placeholder="Buscar módulo..." className="sm:w-64" />
            )}
          </div>
          {visible.length ? (
            <Accordion type="multiple" value={open ?? []} onValueChange={setOpen} className="space-y-2">
              {visible.map((connection) => (
                <ConnectionItem
                  key={connection.id}
                  connection={connection}
                  saving={save.isPending}
                  onSave={(patch) => save.mutate({ id: connection.id, patch })}
                />
              ))}
            </Accordion>
          ) : (
            <EmptyState variant="compact" icon={Plug} title={`Ningún módulo coincide con «${search}».`} />
          )}
        </>
      )}
    </div>
  )
}
