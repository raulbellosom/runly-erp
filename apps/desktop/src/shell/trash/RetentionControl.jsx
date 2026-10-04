// "Eliminar automáticamente después de" for the active company (spec
// 2026-10-04-trash-retention-conflicts §4.3). Read-only text for users
// without core.records.purge.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { SelectField } from '@runly/ui'
import { toast } from 'sonner'
import { useAuth } from '../../auth/AuthProvider'
import { useActiveCompany } from '../../company/ActiveCompanyProvider'
import { runly } from '../../lib/runly'

const labelOf = (days) => (days ? `${days} días` : 'Nunca')

export function RetentionControl() {
  const { session } = useAuth()
  const { activeCompanyId } = useActiveCompany()
  const token = session?.access_token
  const queryClient = useQueryClient()
  const key = ['trash', 'retention', activeCompanyId]
  const query = useQuery({ queryKey: key, queryFn: async () => (await runly.trash.retention(token)).data, enabled: Boolean(token), retry: false })
  const save = useMutation({
    mutationFn: async (days) => (await runly.trash.setRetention(days, token)).data,
    onSuccess: (data) => { queryClient.setQueryData(key, (current) => ({ ...current, days: data.days })); toast.success(data.days ? `Lo desactivado se eliminará después de ${data.days} días` : 'El borrado automático quedó apagado') },
    onError: (error) => toast.error('No se pudo guardar', { description: error.message }),
  })
  const data = query.data
  if (!data) return null
  const hint = data.days
    ? `Lo que lleve más de ${data.days} días desactivado se elimina solo (si otros registros lo usan, se desvincula cuando se puede; si no, se conserva y queda en la bitácora). Archivos no se elimina automáticamente.`
    : 'Nada se elimina automáticamente.'
  if (!data.canEdit) return <p className="text-xs text-[hsl(var(--muted-foreground))]">Eliminación automática: {labelOf(data.days)}. {hint}</p>
  return (
    <div className="max-w-xl space-y-1">
      <SelectField
        id="trash-retention"
        label="Eliminar automáticamente después de"
        value={String(data.days)}
        options={data.options.map((days) => ({ value: String(days), label: labelOf(days) }))}
        disabled={save.isPending}
        onValueChange={(value) => save.mutate(Number(value))}
      />
      <p className="text-xs text-[hsl(var(--muted-foreground))]">{hint}</p>
    </div>
  )
}
