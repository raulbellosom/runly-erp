// apps/desktop/src/modules/runly.catalog/components/VariantOptionsEditor.jsx
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button, Input, cn } from '@runly/ui'
import { Plus, Tag, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { runly } from '../../../lib/runly.js'
import { pickCategoryStyle } from '../lib/categoryVisuals.js'

export default function VariantOptionsEditor({ token, productId, options = [] }) {
  const queryClient = useQueryClient()
  const [newOptionName, setNewOptionName] = useState('')

  const addMutation = useMutation({
    mutationFn: (data) => runly.catalog.createOption(productId, data, token),
    onSuccess: () => {
      toast.success('Opcion creada')
      setNewOptionName('')
      queryClient.invalidateQueries({ queryKey: ['catalog-product', productId] })
    },
    onError: err => toast.error(err?.message ?? 'Error'),
  })

  const deleteMutation = useMutation({
    mutationFn: (optionId) => runly.catalog.deleteOption(productId, optionId, token),
    onSuccess: () => {
      toast.success('Opcion eliminada')
      queryClient.invalidateQueries({ queryKey: ['catalog-product', productId] })
    },
    onError: err => toast.error(err?.message ?? 'Error'),
  })

  const updateMutation = useMutation({
    mutationFn: ({ optionId, values }) => runly.catalog.updateOption(productId, optionId, { values }, token),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['catalog-product', productId] }),
    onError: err => toast.error(err?.message ?? 'Error'),
  })

  function handleAddOption(e) {
    e.preventDefault()
    if (!newOptionName.trim()) return
    addMutation.mutate({ name: newOptionName.trim(), values: [] })
  }

  function handleAddValue(option, val) {
    if (!val.trim()) return
    const current = option.values.map(v => v.value)
    if (current.includes(val.trim())) return
    updateMutation.mutate({ optionId: option.id, values: [...current, val.trim()] })
  }

  function handleRemoveValue(option, val) {
    updateMutation.mutate({ optionId: option.id, values: option.values.map(v => v.value).filter(v => v !== val) })
  }

  return (
    <div className="space-y-4">
      <p className="text-xs font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">Opciones de variantes</p>

      {options.map(opt => (
        <OptionRow
          key={opt.id}
          option={opt}
          onDelete={() => deleteMutation.mutate(opt.id)}
          onAddValue={val => handleAddValue(opt, val)}
          onRemoveValue={val => handleRemoveValue(opt, val)}
        />
      ))}

      <form onSubmit={handleAddOption} className="flex gap-2">
        <Input
          placeholder="Nueva opcion (ej. Talla, Color...)"
          value={newOptionName}
          onChange={e => setNewOptionName(e.target.value)}
          className="max-w-xs"
        />
        <Button type="submit" variant="outline" size="sm" disabled={addMutation.isPending}>
          <Plus className="h-4 w-4 mr-1" /> Agregar opcion
        </Button>
      </form>
    </div>
  )
}

function OptionRow({ option, onDelete, onAddValue, onRemoveValue }) {
  const [newVal, setNewVal] = useState('')
  const style = pickCategoryStyle(option.name)

  function handleKeyDown(e) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    onAddValue(newVal)
    setNewVal('')
  }

  return (
    <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 space-y-3 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', style.bg, style.fg)}>
            <Tag className="h-3.5 w-3.5" />
          </span>
          <p className="text-sm font-semibold text-[hsl(var(--foreground))]">{option.name}</p>
        </div>
        <button
          type="button"
          onClick={onDelete}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] hover:bg-red-100 hover:text-red-600 transition-colors"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        {option.values.map(v => (
          <span key={v.id} className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium', style.bg, style.fg)}>
            {v.value}
            <button type="button" onClick={() => onRemoveValue(v.value)} className="hover:text-red-500 ml-0.5">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <Input
          placeholder="Nuevo valor + Enter"
          value={newVal}
          onChange={e => setNewVal(e.target.value)}
          onKeyDown={handleKeyDown}
          className="h-7 w-36 text-xs"
        />
      </div>
    </div>
  )
}
