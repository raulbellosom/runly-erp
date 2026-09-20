import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, Pencil, EyeOff } from 'lucide-react'
import {
  PageHeader, Badge, Button, EmptyState, ErrorState, ConfirmDialog,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  TextField, SelectField,
} from '@runly/ui'
import { useAuth } from '../../../auth/AuthProvider'
import { getApiUrl } from '../../../lib/runtimeConfig.js'
import { useLedgerCategories, useLedgerSQLite } from '../hooks/use-ledger-queries.js'

const API_BASE = getApiUrl()

const KIND_OPTIONS = [
  { value: 'income',  label: 'Ingreso' },
  { value: 'expense', label: 'Egreso'  },
  { value: 'both',    label: 'Ambos'   },
]

const categorySchema = z.object({
  name:  z.string().min(1, 'El nombre es requerido'),
  color: z.string().optional().default('#94a3b8'),
  kind:  z.enum(['income', 'expense', 'both']),
})

async function apiRequest(method, path, token, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error ?? 'Error al procesar la solicitud.')
  return json
}

export default function CategoriesScreen() {
  const { session } = useAuth()
  const token = session?.access_token ?? null
  const queryClient = useQueryClient()
  const { isUsingLocalLedger } = useLedgerSQLite()
  const canEdit = !isUsingLocalLedger && !!token

  const [formOpen, setFormOpen] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [deactivateTarget, setDeactivateTarget] = useState(null)

  const { data, isLoading, isError, refetch } = useLedgerCategories()

  const form = useForm({
    resolver: zodResolver(categorySchema),
    defaultValues: { name: '', color: '#94a3b8', kind: 'both' },
  })

  function openCreate() {
    setEditTarget(null)
    form.reset({ name: '', color: '#94a3b8', kind: 'both' })
    setFormOpen(true)
  }

  function openEdit(category) {
    setEditTarget(category)
    form.reset({ name: category.name, color: category.color ?? '#94a3b8', kind: category.kind ?? 'both' })
    setFormOpen(true)
  }

  const saveMutation = useMutation({
    mutationFn: (values) => editTarget
      ? apiRequest('PATCH', `/ledger/categories/${editTarget.id}`, token, values)
      : apiRequest('POST', '/ledger/categories', token, values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ledger-categories'] })
      setFormOpen(false)
    },
    onError: (err) => form.setError('root', { message: err.message }),
  })

  const deactivateMutation = useMutation({
    mutationFn: (categoryId) => apiRequest('PATCH', `/ledger/categories/${categoryId}/enabled`, token, { enabled: false }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ledger-categories'] })
      setDeactivateTarget(null)
    },
  })

  const categories = data?.data ?? []
  const system = categories.filter(c => c.is_system)
  const personal = categories.filter(c => !c.is_system)

  function renderRows(rows, showActions) {
    return rows.map(cat => (
      <tr key={cat.id} className="border-b border-[hsl(var(--border)/0.5)] hover:bg-[hsl(var(--muted)/0.15)]">
        <td className="px-4 py-2.5 w-8">
          <span
            className="inline-block w-4 h-4 rounded-full border border-[hsl(var(--border)/0.5)] shrink-0"
            style={{ backgroundColor: cat.color ?? '#94a3b8' }}
          />
        </td>
        <td className="px-4 py-2.5 text-sm font-medium">
          <span className="flex items-center gap-2">
            {cat.name}
            {cat.is_system && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">Sistema</Badge>
            )}
          </span>
        </td>
        <td className="px-4 py-2.5 text-sm text-[hsl(var(--muted-foreground))]">
          {KIND_OPTIONS.find(o => o.value === cat.kind)?.label ?? cat.kind}
        </td>
        <td className="px-4 py-2.5 text-right">
          {showActions && (
            <span className="flex justify-end gap-1">
              <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => openEdit(cat)}>
                <Pencil size={13} className="mr-1" />
                Editar
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[hsl(var(--muted-foreground))] hover:text-red-500"
                onClick={() => setDeactivateTarget(cat)}
              >
                <EyeOff size={13} className="mr-1" />
                Desactivar
              </Button>
            </span>
          )}
        </td>
      </tr>
    ))
  }

  return (
    <div className="p-4 md:p-6 min-h-dvh">
      <PageHeader
        title="Categorias"
        description="Agrupa movimientos por naturaleza. Las categorias de sistema son visibles para todos; las personales solo para ti."
        actions={
          <Button onClick={openCreate} disabled={!canEdit}>
            <Plus size={15} className="mr-1.5" />
            Nueva categoria
          </Button>
        }
      />

      {isLoading && (
        <div className="space-y-2 mt-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-10 rounded-lg bg-[hsl(var(--muted)/0.4)] animate-pulse" />
          ))}
        </div>
      )}

      {isError && (
        <ErrorState
          className="mt-4"
          description="No se pudieron cargar las categorias."
          onRetry={refetch}
        />
      )}

      {!isLoading && !isError && categories.length === 0 && (
        <EmptyState
          icon={Plus}
          title="Sin categorias"
          description="Crea tu primera categoria personal para clasificar tus movimientos."
          action={canEdit ? { label: 'Nueva categoria', onClick: openCreate } : undefined}
        />
      )}

      {!isLoading && !isError && categories.length > 0 && (
        <div className="mt-4 rounded-xl border border-[hsl(var(--border))] overflow-hidden">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-[hsl(var(--muted)/0.3)] border-b border-[hsl(var(--border))]">
                <th className="px-4 py-2.5 w-8" />
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-[hsl(var(--muted-foreground))]">Nombre</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-[hsl(var(--muted-foreground))]">Tipo</th>
                <th className="px-4 py-2.5 w-48" />
              </tr>
            </thead>
            <tbody>
              {system.length > 0 && (
                <>
                  <tr className="bg-[hsl(var(--muted)/0.15)]">
                    <td colSpan={4} className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                      Sistema
                    </td>
                  </tr>
                  {renderRows(system, false)}
                </>
              )}
              {personal.length > 0 && (
                <>
                  <tr className="bg-[hsl(var(--muted)/0.15)]">
                    <td colSpan={4} className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                      Mis categorias
                    </td>
                  </tr>
                  {renderRows(personal, canEdit)}
                </>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Create / Edit dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{editTarget ? 'Editar categoria' : 'Nueva categoria'}</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={form.handleSubmit((values) => saveMutation.mutate(values))}
            className="space-y-4 py-2"
          >
            <TextField
              label="Nombre"
              placeholder="Ej. Transporte"
              required
              {...form.register('name')}
              error={form.formState.errors.name?.message}
            />
            <div className="flex gap-3 items-end">
              <div className="flex-1">
                <Controller
                  control={form.control}
                  name="kind"
                  render={({ field }) => (
                    <SelectField
                      label="Tipo"
                      options={KIND_OPTIONS}
                      required
                      value={field.value}
                      onValueChange={field.onChange}
                      error={form.formState.errors.kind?.message}
                    />
                  )}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">Color</span>
                <input
                  type="color"
                  className="h-9 w-16 rounded-lg border border-[hsl(var(--border))] cursor-pointer p-0.5"
                  {...form.register('color')}
                />
              </div>
            </div>
            {form.formState.errors.root && (
              <p className="text-sm text-red-500">{form.formState.errors.root.message}</p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={saveMutation.isPending}>
                {saveMutation.isPending ? 'Guardando...' : (editTarget ? 'Guardar cambios' : 'Crear categoria')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Deactivate confirm dialog */}
      <ConfirmDialog
        open={!!deactivateTarget}
        onOpenChange={(open) => !open && setDeactivateTarget(null)}
        title="Desactivar categoria"
        description={`¿Desactivar "${deactivateTarget?.name}"? Dejara de aparecer en el registro de movimientos.`}
        confirmLabel="Desactivar"
        onConfirm={() => deactivateMutation.mutate(deactivateTarget.id)}
      />
    </div>
  )
}
