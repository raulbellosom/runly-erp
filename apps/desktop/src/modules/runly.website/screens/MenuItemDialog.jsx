import { companyFetch } from '../../../lib/companyFetch.js'
import { useState, useEffect } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useAuth } from '../../../auth/AuthProvider.jsx'
import { getApiUrl } from '../../../lib/runtimeConfig.js'
import {
  Button, SelectField, TextField,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@runly/ui'
import { toast } from 'sonner'

const TARGET_OPTIONS = [
  { value: '_self',  label: 'Misma ventana' },
  { value: '_blank', label: 'Nueva ventana' },
]

export default function MenuItemDialog({ menuId, item, open, onOpenChange, onSaved, rootItems = [] }) {
  const { session } = useAuth()
  const token = session?.access_token

  const [form, setForm] = useState({
    label: '', url: '', target: '_self', icon: '', parentId: '',
  })

  useEffect(() => {
    if (open) {
      setForm({
        label:    item?.label    ?? '',
        url:      item?.url      ?? '',
        target:   item?.target   ?? '_self',
        icon:     item?.icon     ?? '',
        parentId: item?.parent_id ?? '',
      })
    }
  }, [open, item])

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const res = await companyFetch(`${getApiUrl()}/website/menus/${menuId}/items`, {
        method: 'POST', headers, body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`)
      return res.json()
    },
    onSuccess: () => { toast.success('Elemento agregado'); onSaved(); onOpenChange(false) },
    onError: (err) => toast.error(err.message || 'Error al agregar elemento'),
  })

  const updateMutation = useMutation({
    mutationFn: async (data) => {
      const res = await companyFetch(`${getApiUrl()}/website/menu-items/${item.id}`, {
        method: 'PATCH', headers, body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`)
      return res.json()
    },
    onSuccess: () => { toast.success('Elemento actualizado'); onSaved(); onOpenChange(false) },
    onError: (err) => toast.error(err.message || 'Error al actualizar elemento'),
  })

  function handleSubmit(e) {
    e.preventDefault()
    const payload = {
      label:    form.label.trim(),
      url:      form.url.trim() || null,
      target:   form.target,
      icon:     form.icon.trim() || null,
      parentId: form.parentId || null,
    }
    if (item) {
      updateMutation.mutate(payload)
    } else {
      createMutation.mutate(payload)
    }
  }

  const isSaving = createMutation.isPending || updateMutation.isPending
  const parentOptions = rootItems.filter((r) => !item || r.id !== item.id)
  const parentSelectOptions = [
    { value: '', label: '— Elemento raiz —' },
    ...parentOptions.map((r) => ({ value: r.id, label: r.label })),
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{item ? 'Editar elemento' : 'Agregar elemento'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <TextField
            label="Etiqueta"
            value={form.label}
            onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
            placeholder="Inicio"
            required
            autoFocus
          />

          <TextField
            label="URL (opcional)"
            value={form.url}
            onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
            placeholder="https://... o /ruta"
          />

          <div className="grid grid-cols-2 gap-4">
            <SelectField
              label="Abrir en"
              value={form.target}
              onChange={(v) => setForm((f) => ({ ...f, target: v }))}
              options={TARGET_OPTIONS}
            />
            <TextField
              label="Icono (opcional)"
              value={form.icon}
              onChange={(e) => setForm((f) => ({ ...f, icon: e.target.value }))}
              placeholder="Home"
            />
          </div>

          {parentOptions.length > 0 && (
            <SelectField
              label="Subelemento de (opcional)"
              value={form.parentId}
              onChange={(v) => setForm((f) => ({ ...f, parentId: v }))}
              options={parentSelectOptions}
            />
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={isSaving || !form.label.trim()}>
              {isSaving ? 'Guardando...' : item ? 'Guardar' : 'Agregar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
