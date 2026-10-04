// Eliminar definitivamente, with what uses the record (spec
// 2026-10-04-trash-retention-conflicts §4.1-4.2): rows deleted with it,
// references that end up empty, and what blocks it. "Desvincular y eliminar"
// clears nullable references in the same transaction. Header and footer stay
// fixed; only the middle scrolls.
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Skeleton } from '@runly/ui'
import { AlertTriangle, Link2Off, Lock, Trash2 } from 'lucide-react'
import { runly } from '../../lib/runly'

function Group({ icon: Icon, title, items, tone }) {
  if (!items?.length) return null
  return (
    <section className={`space-y-1 rounded-xl p-3 text-sm ${tone}`}>
      <p className="flex items-center gap-2 font-medium"><Icon className="h-4 w-4" /> {title}</p>
      <ul className="list-disc pl-6">
        {items.map((dep) => <li key={dep.constraint}>{dep.count} en {dep.label}{dep.connection ? ' (Impedir la eliminación)' : ''}</li>)}
      </ul>
    </section>
  )
}

export function PurgeDialog({ row, providerId, token, onOpenChange, onConfirm, pending }) {
  const [confirming, setConfirming] = useState(false)
  const query = useQuery({
    queryKey: ['trash', 'dependents', providerId, row?.id],
    queryFn: async () => (await runly.trash.dependents(providerId, row.id, token)).data,
    enabled: Boolean(row && token),
    staleTime: 0,
  })
  if (!row) return null
  const deps = query.data ?? { cascade: [], setNull: [], unlinkable: [], blocking: [] }
  const blocked = deps.blocking.length > 0
  const needsUnlink = deps.unlinkable.length > 0
  const clean = !blocked && !needsUnlink && !deps.cascade.length && !deps.setNull.length

  return (
    <Dialog open={Boolean(row)} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-md">
        <DialogHeader className="shrink-0">
          <DialogTitle>Eliminar definitivamente</DialogTitle>
          <DialogDescription>"{row.label || 'Este registro'}" se borrará para siempre.</DialogDescription>
        </DialogHeader>
        <div className="-mx-6 min-h-0 flex-1 space-y-3 overflow-y-auto px-6">
          {query.isLoading ? <Skeleton className="h-20 w-full rounded-xl" /> : (
            <>
              <Group icon={Lock} title="No se puede eliminar: lo usan" items={deps.blocking} tone="bg-red-500/10 text-red-700 dark:text-red-300" />
              {blocked && <p className="text-xs text-[hsl(var(--muted-foreground))]">Elimina o cambia primero esos registros, o reactívalo.</p>}
              <Group icon={Trash2} title="Se eliminarán también" items={deps.cascade} tone="bg-amber-500/10 text-amber-800 dark:text-amber-300" />
              <Group icon={Link2Off} title="Quedarán sin este dato" items={[...deps.setNull, ...deps.unlinkable]} tone="bg-sky-500/10 text-sky-800 dark:text-sky-300" />
              {clean && <p className="text-sm text-[hsl(var(--muted-foreground))]">Ningún otro registro lo usa.</p>}
              {confirming && !blocked && (
                <p className="flex items-start gap-2 rounded-xl bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> Esta acción no se puede deshacer. ¿Eliminar para siempre?
                </p>
              )}
            </>
          )}
        </div>
        <DialogFooter className="shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          {!blocked && (
            <Button
              variant="destructive"
              disabled={query.isLoading || pending}
              onClick={() => (confirming ? onConfirm({ unlink: needsUnlink }) : setConfirming(true))}
            >
              {confirming ? 'Eliminar definitivamente' : needsUnlink ? 'Desvincular y eliminar' : 'Continuar'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
