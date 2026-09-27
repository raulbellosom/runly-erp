// apps/desktop/src/modules/runly.catalog/components/VariantMatrix.jsx
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Badge, Button, ConfirmDialog, Input, cn } from '@runly/ui'
import { Plus, Save, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { runly } from '../../../lib/runly.js'
import { pickCategoryStyle } from '../lib/categoryVisuals.js'
import { getStockStatus, STOCK_STATUS_META } from '../lib/stockStatus.js'

export default function VariantMatrix({ token, productId, variants = [] }) {
  const queryClient  = useQueryClient()
  const [edits, setEdits] = useState({})
  const [confirmDelete, setConfirmDelete] = useState(null)

  const updateMutation = useMutation({
    mutationFn: ({ variantId, data }) => runly.catalog.updateVariant(productId, variantId, data, token),
    onSuccess: (_, { variantId }) => {
      setEdits(prev => { const n = { ...prev }; delete n[variantId]; return n })
      queryClient.invalidateQueries({ queryKey: ['catalog-product', productId] })
      toast.success('Variante guardada')
    },
    onError: err => toast.error(err?.message ?? 'Error'),
  })

  const createMutation = useMutation({
    mutationFn: (data) => runly.catalog.createVariant(productId, data, token),
    onSuccess: () => {
      toast.success('Variante creada')
      queryClient.invalidateQueries({ queryKey: ['catalog-product', productId] })
    },
    onError: err => toast.error(err?.message ?? 'Error'),
  })

  const deleteMutation = useMutation({
    mutationFn: (variantId) => runly.catalog.deleteVariant(productId, variantId, token),
    onSuccess: () => {
      toast.success('Variante eliminada')
      queryClient.invalidateQueries({ queryKey: ['catalog-product', productId] })
    },
    onError: err => toast.error(err?.message ?? 'Error'),
  })

  function edit(variantId, field, value) {
    setEdits(prev => ({ ...prev, [variantId]: { ...(prev[variantId] ?? {}), [field]: value } }))
  }

  function getValuePairs(optionValues) {
    if (!optionValues || typeof optionValues !== 'object') return []
    return Object.entries(optionValues).filter(([, v]) => v)
  }

  return (
    <div className="space-y-4">
      <p className="text-xs font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
        Variantes ({variants.length})
      </p>

      {variants.length === 0 ? (
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          Define las opciones arriba y agrega variantes aqui.
        </p>
      ) : (
        <div className="rounded-2xl border border-[hsl(var(--border))] overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]/40">
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-[hsl(var(--muted-foreground))]">Variante</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-[hsl(var(--muted-foreground))]">SKU</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-[hsl(var(--muted-foreground))]">Cod. barras</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-[hsl(var(--muted-foreground))]">Precio</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-[hsl(var(--muted-foreground))]">Stock</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[hsl(var(--border))]">
              {variants.map(v => {
                const e       = edits[v.id] ?? {}
                const isDirty = Boolean(edits[v.id])
                const pairs   = getValuePairs(v.option_values)
                const stockVal = Number(e.stock ?? v.stock ?? 0)
                const status  = getStockStatus({ trackStock: true, stock: stockVal })
                return (
                  <tr key={v.id} className={cn('transition-colors', isDirty && 'bg-blue-50/30 dark:bg-blue-900/10')}>
                    <td className="px-4 py-2">
                      {pairs.length === 0 ? (
                        <span className="text-sm font-medium text-[hsl(var(--muted-foreground))]">Default</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {pairs.map(([key, value]) => {
                            const style = pickCategoryStyle(key)
                            return (
                              <span key={key} className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium', style.bg, style.fg)}>
                                {value}
                              </span>
                            )
                          })}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <Input value={e.sku ?? v.sku ?? ''} onChange={ev => edit(v.id, 'sku', ev.target.value)} className="h-7 w-28 text-xs" placeholder="SKU" />
                    </td>
                    <td className="px-4 py-2">
                      <Input value={e.barcode ?? v.barcode ?? ''} onChange={ev => edit(v.id, 'barcode', ev.target.value)} className="h-7 w-32 text-xs" placeholder="EAN/UPC" />
                    </td>
                    <td className="px-4 py-2">
                      <Input type="number" min="0" step="0.01" value={e.price ?? v.price ?? 0} onChange={ev => edit(v.id, 'price', Number(ev.target.value))} className="h-7 w-24 text-xs" />
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-1.5">
                        <Input type="number" min="0" value={e.stock ?? v.stock ?? 0} onChange={ev => edit(v.id, 'stock', Number(ev.target.value))} className="h-7 w-20 text-xs" />
                        <Badge variant={STOCK_STATUS_META[status].tone} className="h-5 shrink-0 px-1.5 text-[9px]">
                          {STOCK_STATUS_META[status].label}
                        </Badge>
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-1">
                        {isDirty && (
                          <button
                            type="button"
                            onClick={() => updateMutation.mutate({ variantId: v.id, data: edits[v.id] })}
                            disabled={updateMutation.isPending}
                            className="flex h-7 w-7 items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] hover:bg-emerald-100 hover:text-emerald-700 transition-colors"
                          >
                            <Save className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(v)}
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] hover:bg-red-100 hover:text-red-600 transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <Button variant="outline" size="sm" onClick={() => createMutation.mutate({ option_values: {}, price: 0, stock: 0 })} disabled={createMutation.isPending}>
        <Plus className="h-4 w-4 mr-1" /> Agregar variante
      </Button>

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        onOpenChange={v => { if (!v) setConfirmDelete(null) }}
        onConfirm={() => { deleteMutation.mutate(confirmDelete.id); setConfirmDelete(null) }}
        title="Eliminar variante"
        description="La variante sera eliminada. Esta accion no se puede deshacer."
        confirmLabel="Eliminar"
      />
    </div>
  )
}
