import { useState } from 'react'
import {
  Badge, Button, ConfirmDialog, EmptyState, ErrorState, Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, Skeleton, TextField,
} from '@runly/ui'
import { History, Loader2, Save } from 'lucide-react'
import { toast } from 'sonner'
import { timeAgo } from '../lib/boardMeta.js'
import { useVersionMutations, useVersions } from '../hooks/useCanvasData.js'
import { VersionRowSkeleton } from './skeletons.jsx'

function VersionRow({ version, current, canRestore, onRestore }) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 p-3">
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="truncate text-sm font-semibold text-[hsl(var(--foreground))]">
          Versión {version.number}{version.name ? <span className="font-normal text-[hsl(var(--muted-foreground))]"> · {version.name}</span> : null}
        </p>
        <p className="text-xs text-[hsl(var(--muted-foreground))]">
          {version.createdByName} · {timeAgo(version.createdAt)} · {version.objectCount} {version.objectCount === 1 ? 'elemento' : 'elementos'}
        </p>
        <div className="flex gap-1.5 pt-0.5">
          {current ? <Badge variant="secondary">Actual</Badge> : null}
          {version.restoredAt ? <Badge variant="outline">Restaurada</Badge> : null}
        </div>
      </div>
      {canRestore ? (
        <Button type="button" size="sm" variant="outline" onClick={() => onRestore(version)} className="shrink-0">Restaurar</Button>
      ) : null}
    </li>
  )
}

export function VersionsSheet({ open, onOpenChange, boardId, currentVersionId, canCreate, canRestore, onRestored }) {
  const [name, setName] = useState('')
  const [target, setTarget] = useState(null)
  const versions = useVersions(boardId, open)
  const { create, restore } = useVersionMutations(boardId)
  const rows = versions.data ?? []

  async function submit(event) {
    event.preventDefault()
    try {
      await create.mutateAsync({ name: name.trim() || undefined })
      toast.success('Versión guardada')
      setName('')
    } catch (error) { toast.error(error.message) }
  }

  async function confirmRestore() {
    if (!target) return
    try {
      await restore.mutateAsync(target.id)
      toast.success('Versión restaurada')
      setTarget(null)
      onRestored?.()
    } catch (error) { toast.error(error.message) }
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="gap-0 p-0">
          <SheetHeader className="shrink-0 border-b border-[hsl(var(--border))] px-4 py-3">
            <SheetTitle>Versiones</SheetTitle>
            <SheetDescription>Guarda el estado del Board para volver a él cuando lo necesites.</SheetDescription>
          </SheetHeader>
          {canCreate ? (
            <form onSubmit={submit} className="flex shrink-0 items-end gap-2 border-b border-[hsl(var(--border))] px-4 py-3">
              <TextField
                label="Nombre de la versión (opcional)" value={name} onChange={(event) => setName(event.target.value)}
                maxLength={200} placeholder="Ej. Antes de reordenar" className="flex-1" autoComplete="off"
              />
              <Button type="submit" disabled={create.isPending} className="shrink-0">
                {create.isPending ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <Save />}
                Guardar versión
              </Button>
            </form>
          ) : null}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {versions.isLoading ? (
              <ul aria-busy="true" className="divide-y divide-[hsl(var(--border))]">
                {[1, 2, 3].map((key) => <VersionRowSkeleton key={key} withAction={canRestore} />)}
              </ul>
            ) : versions.isError ? (
              <div className="p-4"><ErrorState title="No se pudieron cargar las versiones" description={versions.error?.message} onRetry={() => versions.refetch()} /></div>
            ) : !rows.length ? (
              <div className="p-4"><EmptyState icon={History} title="Sin versiones" description="Guarda una versión para poder volver a este punto." /></div>
            ) : (
              <ul className="divide-y divide-[hsl(var(--border))]">
                {rows.map((version) => (
                  <VersionRow
                    key={version.id} version={version} current={version.id === currentVersionId} canRestore={canRestore}
                    onRestore={setTarget}
                  />
                ))}
              </ul>
            )}
          </div>
        </SheetContent>
      </Sheet>
      <ConfirmDialog
        open={Boolean(target)} onOpenChange={(next) => { if (!next) setTarget(null) }}
        title={`Restaurar la versión ${target?.number ?? ''}`}
        description="Se reemplazará el contenido del Board por esta versión. Antes se guardará una versión automática del estado actual."
        confirmLabel="Restaurar" onConfirm={confirmRestore} loading={restore.isPending}
      />
    </>
  )
}
