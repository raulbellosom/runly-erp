// "Desactivados" of a module (spec 2026-10-03-records-trash-design §10):
// deactivated records per entity with Reactivar and Eliminar definitivamente
// (two confirmations). Rendered by ModuleOutlet for /<module>/desactivados.
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, ConfirmDialog, DataTable, EmptyState, PageHeader, SelectField, TextField } from '@runly/ui'
import { Archive, RotateCcw, Search, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../auth/AuthProvider'
import { useActiveCompany } from '../../company/ActiveCompanyProvider'
import { runly } from '../../lib/runly'
import { useTrashProviders } from './useTrashProviders'

const formatDate = (value) => (value ? new Date(value).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : '—')

export function TrashScreen({ moduleKey, moduleName }) {
  const { session } = useAuth()
  const { activeCompanyId } = useActiveCompany()
  const token = session?.access_token
  const queryClient = useQueryClient()
  const providersQuery = useTrashProviders(moduleKey)
  const providers = useMemo(() => providersQuery.data ?? [], [providersQuery.data])
  const [providerId, setProviderId] = useState(null)
  const [search, setSearch] = useState('')
  const [term, setTerm] = useState('')
  const [purge, setPurge] = useState({ row: null, step: 0 })

  useEffect(() => {
    if (!providers.length) return
    if (!providers.some((provider) => provider.id === providerId)) {
      setProviderId((providers.find((provider) => provider.count > 0) ?? providers[0]).id)
    }
  }, [providers, providerId])
  useEffect(() => {
    const handle = setTimeout(() => setTerm(search.trim()), 300)
    return () => clearTimeout(handle)
  }, [search])

  const provider = providers.find((item) => item.id === providerId)
  const itemsKey = ['trash', 'items', providerId, term, activeCompanyId]
  const itemsQuery = useQuery({
    queryKey: itemsKey,
    queryFn: async () => {
      const result = await runly.trash.items(providerId, { search: term || undefined }, token)
      if (result?.error) throw new Error(result.error)
      return result.data
    },
    enabled: Boolean(token && providerId),
  })

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['trash'] })
  const restore = useMutation({
    mutationFn: async (row) => {
      const result = await runly.trash.restore(providerId, row.id, token)
      if (result?.error) throw new Error(result.error)
      return result.data
    },
    onSuccess: (data) => { toast.success(`${data.label || 'El registro'} se reactivó`); refresh() },
    onError: (error) => toast.error('No se pudo reactivar', { description: error.message }),
  })
  const remove = useMutation({
    mutationFn: async (row) => {
      const result = await runly.trash.purge(providerId, row.id, token)
      if (result?.error) throw new Error(result.error)
      return result.data
    },
    onSuccess: (data) => { toast.success(`${data.label || 'El registro'} se eliminó definitivamente`); refresh() },
    onError: (error) => toast.error('No se pudo eliminar', { description: error.message }),
  })

  const columns = useMemo(() => [
    { id: 'label', header: provider?.label ?? 'Registro', cell: ({ row }) => <span className="font-medium">{row.original.label || 'Sin nombre'}</span> },
    { id: 'deactivatedAt', header: 'Desactivado', cell: ({ row }) => formatDate(row.original.deactivatedAt) },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" disabled={restore.isPending} onClick={() => restore.mutate(row.original)}>
            <RotateCcw className="h-3.5 w-3.5" /> Reactivar
          </Button>
          {provider?.canPurge && (
            <Button size="sm" variant="ghost" className="text-red-600" disabled={remove.isPending} onClick={() => setPurge({ row: row.original, step: 1 })}>
              <Trash2 className="h-3.5 w-3.5" /> Eliminar
            </Button>
          )}
        </div>
      ),
    },
  ], [provider, restore, remove])

  const description = 'Registros que se desactivaron. Puedes reactivarlos o, si ya no los necesitas, eliminarlos definitivamente.'
  if (!providersQuery.isLoading && !providers.length) {
    return (
      <div className="space-y-6 p-4 md:p-6">
        <PageHeader eyebrow={moduleName} title="Desactivados" description={description} />
        <EmptyState icon={Archive} title="Sin registros que gestionar" description="Este módulo no tiene registros desactivados que puedas administrar." />
      </div>
    )
  }

  return (
    <div className="space-y-4 p-4 md:p-6">
      <PageHeader eyebrow={moduleName} title="Desactivados" description={description} />
      <div className={providers.length > 1 ? 'grid gap-3 sm:grid-cols-[minmax(0,240px)_minmax(0,1fr)]' : 'max-w-xl'}>
        {providers.length > 1 && (
          <SelectField
            label="Tipo de registro"
            value={providerId ?? ''}
            options={providers.map((item) => ({ value: item.id, label: `${item.pluralLabel} (${item.count})` }))}
            onValueChange={(value) => { setProviderId(value); setSearch('') }}
          />
        )}
        <TextField label="Buscar" icon={Search} value={search} placeholder={`Buscar ${provider?.pluralLabel?.toLowerCase() ?? 'registros'}...`} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {/* Server-side search above; the table's own client filter would only see this page. */}
      <DataTable
        showToolbar={false}
        columns={columns}
        data={itemsQuery.data?.items ?? []}
        isLoading={providersQuery.isLoading || itemsQuery.isLoading}
        isError={itemsQuery.isError}
        onRetry={() => itemsQuery.refetch()}
        emptyIcon={Archive}
        emptyTitle={term ? 'Sin resultados' : 'No hay registros desactivados'}
        emptyDescription={term ? 'Prueba con otro texto.' : 'Cuando desactives un registro aparecerá aquí.'}
      />
      {(itemsQuery.data?.total ?? 0) > (itemsQuery.data?.items?.length ?? 0) && (
        <p className="text-xs text-[hsl(var(--muted-foreground))]">Mostrando los {itemsQuery.data.items.length} más recientes de {itemsQuery.data.total}. Usa la búsqueda para encontrar otros.</p>
      )}
      <ConfirmDialog
        open={purge.step === 1}
        onOpenChange={(open) => !open && setPurge({ row: null, step: 0 })}
        title="Eliminar definitivamente"
        description={`"${purge.row?.label || 'Este registro'}" se borrará para siempre. Si otros registros dependen de él, no se eliminará.`}
        confirmLabel="Continuar"
        onConfirm={() => setPurge((current) => ({ ...current, step: 2 }))}
      />
      <ConfirmDialog
        open={purge.step === 2}
        onOpenChange={(open) => !open && setPurge({ row: null, step: 0 })}
        title="¿Eliminar para siempre?"
        description="Esta acción no se puede deshacer."
        confirmLabel="Eliminar definitivamente"
        loading={remove.isPending}
        onConfirm={() => { remove.mutate(purge.row); setPurge({ row: null, step: 0 }) }}
      />
    </div>
  )
}
