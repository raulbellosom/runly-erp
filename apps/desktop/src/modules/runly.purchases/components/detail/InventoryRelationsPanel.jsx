import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Boxes, PackagePlus, Unlink } from 'lucide-react'
import { Button, ConfirmDialog, EmptyState } from '@runly/ui'
import { useRelationMutations } from '../../hooks/usePurchases.js'
import { INVENTORY_BASE, ORIGIN_LABELS, toAppPath } from '../../lib/purchases-constants.js'
import { InventoryItemPicker } from '../editor/InventoryItemPicker.jsx'

const ORIGIN_TONE = { MANUAL: 'bg-slate-500/10 text-slate-600 dark:text-slate-300', INHERITED: 'bg-sky-500/10 text-sky-700 dark:text-sky-300', AUTOMATIC: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300', MIGRATED: 'bg-amber-500/10 text-amber-700 dark:text-amber-300' }

export const isInventoryRelation = (r) => r?.other?.type === 'inventory_item' || r?.other?.module === 'runly.inventory'

// Inventory items linked to this document, both ways: pick more from
// Inventario or unlink. Items open in the inventory detail.
export function InventoryRelationsPanel({ entityType, doc, canManage }) {
  const navigate = useNavigate()
  const { bulk, remove } = useRelationMutations()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [unlink, setUnlink] = useState(null)
  const relations = (doc.relations ?? []).filter(isInventoryRelation)

  const addItems = (items) => {
    const known = new Set(relations.map((r) => r.other.id))
    const targetIds = items.map((i) => i.id).filter((id) => !known.has(id))
    if (!targetIds.length) return
    bulk.mutate({ sourceType: entityType, sourceId: doc.id, targetType: 'inventory_item', targetIds })
  }

  return (
    <div className="space-y-4">
      {canManage ? (
        <div className="flex justify-end">
          <Button variant="outline" onClick={() => setPickerOpen(true)} disabled={bulk.isPending}><PackagePlus className="h-4 w-4" />Relacionar activos</Button>
        </div>
      ) : null}
      {!relations.length ? (
        <EmptyState icon={Boxes} title="Sin activos relacionados"
          description="Relaciona los equipos que cubre este documento, o crea activos desde un concepto de tipo bien." />
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {relations.map((r) => (
            <li key={r.id} className="flex items-center gap-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 text-violet-700 dark:text-violet-300"><Boxes className="h-4 w-4" /></span>
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => navigate(toAppPath(r.other.path, 'runly.inventory') ?? `${INVENTORY_BASE}/${r.other.id}`)}>
                <span className="block truncate text-sm font-medium hover:underline">{r.other.label ?? 'Activo'}</span>
                <span className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]">
                  <span className="truncate">{r.other.sublabel}</span>
                  <span className={`shrink-0 rounded-full px-1.5 py-px text-[10px] font-medium ${ORIGIN_TONE[r.origin] ?? ORIGIN_TONE.MANUAL}`}>{ORIGIN_LABELS[r.origin] ?? r.origin}</span>
                </span>
              </button>
              {canManage ? (
                <Button variant="ghost" size="icon-sm" aria-label={`Quitar relación con ${r.other.label}`} title="Quitar relación" onClick={() => setUnlink(r)}>
                  <Unlink className="h-4 w-4" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <InventoryItemPicker open={pickerOpen} onOpenChange={setPickerOpen} onConfirm={addItems} />
      <ConfirmDialog open={Boolean(unlink)} onOpenChange={(o) => { if (!o) setUnlink(null) }}
        title="Quitar relación" description="El activo sigue en Inventario; solo deja de estar ligado a este documento."
        detail={unlink?.other?.label} confirmLabel="Quitar relación" loading={remove.isPending}
        onConfirm={() => remove.mutate(unlink.id, { onSuccess: () => setUnlink(null) })} />
    </div>
  )
}
