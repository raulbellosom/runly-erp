import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Badge, Button, Card, CardContent, CardHeader, CardTitle, CheckboxField, DataTable, EmptyState, ErrorState,
  IconGlyph, PageHeader, Skeleton, SwitchField,
} from '@runly/ui'
import { AlertTriangle, Plug, Save } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../auth/AuthProvider'
import { useActiveCompany } from '../../company/ActiveCompanyProvider'
import { runly } from '../../lib/runly'

// "Conexiones" of a core module (spec 2026-10-03-rme3-module-platform-v2 §8.2):
// which custom modules connect to this entity, on/off, and which offered
// fields show in the form, detail, list columns and search.

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

function ConnectionCard({ connection, onSave, saving }) {
  const [config, setConfig] = useState(connection.fieldConfig ?? [])
  useEffect(() => setConfig(connection.fieldConfig ?? []), [connection.fieldConfig])
  const dirty = JSON.stringify(config) !== JSON.stringify(connection.fieldConfig ?? [])
  const pending = connection.status === 'pending'

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
    <Card>
      <CardHeader className="flex flex-col gap-3 space-y-0 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            {connection.moduleIcon ? <IconGlyph name={kebab(connection.moduleIcon)} className="h-4 w-4 text-primary" /> : <Plug className="h-4 w-4 text-primary" />}
            {connection.label}
            <Badge variant="secondary">{connection.kind === 'fields' ? 'Campos' : 'Registros relacionados'}</Badge>
            {pending && <Badge variant="warning">Pendiente</Badge>}
            {!connection.moduleAvailable && <Badge variant="outline">Módulo inactivo</Badge>}
          </CardTitle>
          <p className="text-sm text-muted-foreground">De {connection.moduleName}. {POLICY_LABEL[connection.onTargetDelete]}</p>
        </div>
        <SwitchField
          label={connection.status === 'active' ? 'Activa' : 'Inactiva'}
          checked={connection.status === 'active'}
          disabled={saving}
          onChange={(checked) => onSave({ status: checked ? 'active' : 'disabled' })}
        />
      </CardHeader>
      <CardContent className="space-y-4">
        {connection.needsReview && (
          <p className="flex items-center gap-2 rounded-xl bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
            <AlertTriangle className="h-4 w-4 shrink-0" /> El módulo cambió los campos que ofrece. Revisa la configuración y guárdala.
          </p>
        )}
        <DataTable
          columns={columns}
          data={rows}
          getRowId={(row) => row.field}
          showToolbar={false}
          showPagination={false}
          pageSize={100}
          emptyTitle="El módulo no ofrece campos"
        />
        <div className="flex flex-wrap justify-end gap-2">
          {pending && (
            <Button variant="outline" disabled={saving} onClick={() => onSave({ status: 'active', fieldConfig: config })}>
              Revisar y activar
            </Button>
          )}
          <Button disabled={!dirty || saving} onClick={() => onSave({ fieldConfig: config })}>
            <Save /> Guardar campos
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

export function ConnectionsScreen({ targetType, title = 'Conexiones', description }) {
  const { session } = useAuth()
  const { activeCompanyId } = useActiveCompany()
  const token = session?.access_token
  const queryClient = useQueryClient()
  const queryKey = ['connections', 'admin', targetType, activeCompanyId]
  const { data = [], isLoading, error, refetch } = useQuery({
    queryKey,
    queryFn: async () => (await runly.connections.list(targetType, token))?.data ?? [],
    enabled: Boolean(token),
    // Connected data changes from other modules, which cannot invalidate
    // this cache: always refetch when the screen opens.
    staleTime: 0,
    refetchOnMount: 'always',
  })
  const save = useMutation({
    mutationFn: ({ id, patch }) => runly.connections.update(id, patch, token),
    onSuccess: () => {
      toast.success('Conexión actualizada.')
      queryClient.invalidateQueries({ queryKey: ['connections'] })
    },
    onError: (err) => toast.error(err?.message ?? 'No se pudo guardar la conexión.'),
  })

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 md:p-6">
      <PageHeader
        title={title}
        description={description ?? 'Módulos que agregan datos a estos registros. Elige cuáles se usan y qué campos se muestran, editan y buscan.'}
      />
      {isLoading ? <Skeleton className="h-48 w-full" /> : error ? (
        <ErrorState description={error.message} onRetry={refetch} />
      ) : !data.length ? (
        <EmptyState icon={Plug} title="Sin conexiones" description="Cuando instales un módulo que se conecte aquí, aparecerá en esta lista para que lo actives." />
      ) : (
        <div className="space-y-4">
          {data.map((connection) => (
            <ConnectionCard
              key={connection.id}
              connection={connection}
              saving={save.isPending}
              onSave={(patch) => save.mutate({ id: connection.id, patch })}
            />
          ))}
        </div>
      )}
    </div>
  )
}
