import { useState } from 'react'
import { Button, ConfirmDialog } from '@runly/ui'
import { Pencil, Trash2 } from 'lucide-react'

export function CatalogRowActions({ name, onEdit, onDelete }) {
  const [confirming, setConfirming] = useState(false)
  return (
    <div className="flex shrink-0 justify-end gap-1">
      <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label={`Editar ${name}`} onClick={onEdit}>
        <Pencil className="h-3.5 w-3.5" />
      </Button>
      <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-[hsl(var(--destructive))]" aria-label={`Eliminar ${name}`} onClick={() => setConfirming(true)}>
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Eliminar «${name}»`}
        description="El registro se desactiva y deja de ofrecerse en los formularios. Los activos que ya lo usan no cambian."
        confirmLabel="Eliminar"
        onConfirm={async () => { setConfirming(false); await onDelete() }}
      />
    </div>
  )
}
