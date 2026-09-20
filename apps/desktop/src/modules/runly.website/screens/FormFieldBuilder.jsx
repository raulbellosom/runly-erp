import { companyFetch } from '../../../lib/companyFetch.js'
import { useState } from 'react'
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors,
} from '@dnd-kit/core'
import {
  arrayMove, SortableContext, verticalListSortingStrategy,
  useSortable, sortableKeyboardCoordinates,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Pencil, Trash2, Type, Mail, Phone, AlignLeft, List, CheckSquare, Hash, Calendar, ToggleLeft, LayoutGrid, Tags, Plus, X } from 'lucide-react'
import { useMutation } from '@tanstack/react-query'
import { useAuth } from '../../../auth/AuthProvider.jsx'
import { getApiUrl } from '../../../lib/runtimeConfig.js'
import {
  Button, CheckboxField, ConfirmDialog, SelectField, TextField,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@runly/ui'
import { toast } from 'sonner'

const FIELD_TYPES = [
  { value: 'text',        label: 'Texto corto',         Icon: Type },
  { value: 'email',       label: 'Email',               Icon: Mail },
  { value: 'phone',       label: 'Telefono',            Icon: Phone },
  { value: 'textarea',    label: 'Texto largo',         Icon: AlignLeft },
  { value: 'select',      label: 'Lista desplegable',   Icon: List },
  { value: 'radio',       label: 'Opciones radio',      Icon: ToggleLeft },
  { value: 'checkbox',    label: 'Casilla',             Icon: CheckSquare },
  { value: 'number',      label: 'Numero',              Icon: Hash },
  { value: 'date',        label: 'Fecha',               Icon: Calendar },
  { value: 'chip_multi',  label: 'Chips multi-seleccion', Icon: Tags },
  { value: 'card_select', label: 'Seleccion en tarjetas', Icon: LayoutGrid },
]

const FIELD_TYPE_OPTIONS = FIELD_TYPES.map(({ value, label }) => ({ value, label }))
const SEMANTIC_OPTIONS = [
  { value: 'custom', label: 'Campo personalizado' },
  { value: 'name', label: 'Nombre del lead' },
  { value: 'email', label: 'Correo del lead' },
  { value: 'phone', label: 'Telefono del lead' },
  { value: 'company', label: 'Empresa del lead' },
  { value: 'message', label: 'Mensaje del lead' },
]

function toFieldName(label) {
  return label
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
}

// Parses existing card_select options from DB [{value,label,description}] to editor state
function parseCardOptions(options) {
  if (!Array.isArray(options)) return [{ label: '', description: '' }]
  return options.map(o =>
    typeof o === 'string'
      ? { label: o, description: '' }
      : { label: o.label ?? '', description: o.description ?? '' }
  )
}

// ── Card options editor ──────────────────────────────────────────────────────
function CardOptionsEditor({ value, onChange }) {
  function update(i, key, val) {
    const next = value.map((o, idx) => idx === i ? { ...o, [key]: val } : o)
    onChange(next)
  }
  function add() { onChange([...value, { label: '', description: '' }]) }
  function remove(i) { onChange(value.filter((_, idx) => idx !== i)) }

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wide">Opciones de tarjeta</p>
      {value.map((opt, i) => (
        <div key={i} className="flex gap-2 items-start rounded-lg border border-[hsl(var(--border))] p-2.5 bg-[hsl(var(--background))]">
          <div className="flex-1 space-y-1.5">
            <input
              className="w-full text-sm border border-[hsl(var(--border))] rounded-md px-2.5 py-1.5 bg-[hsl(var(--background))] text-[hsl(var(--foreground))] outline-none focus:ring-1 focus:ring-[hsl(var(--primary))]"
              placeholder="Titulo de la opcion"
              value={opt.label}
              onChange={e => update(i, 'label', e.target.value)}
            />
            <input
              className="w-full text-xs border border-[hsl(var(--border))] rounded-md px-2.5 py-1.5 bg-[hsl(var(--background))] text-[hsl(var(--muted-foreground))] outline-none focus:ring-1 focus:ring-[hsl(var(--primary))]"
              placeholder="Descripcion (opcional)"
              value={opt.description}
              onChange={e => update(i, 'description', e.target.value)}
            />
          </div>
          <button
            type="button"
            onClick={() => remove(i)}
            className="mt-1 p-1 rounded hover:bg-[hsl(var(--destructive)/0.1)] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--destructive))]"
          >
            <X size={13} />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="w-full rounded-lg border border-dashed border-[hsl(var(--border))] py-1.5 text-xs text-[hsl(var(--muted-foreground))] hover:border-[hsl(var(--primary))] hover:text-[hsl(var(--primary))] transition-colors flex items-center justify-center gap-1"
      >
        <Plus size={12} /> Agregar opcion
      </button>
    </div>
  )
}

// ── Field form (inside dialog) ───────────────────────────────────────────────
function FieldForm({ formId, field, isEdit, onOpenChange, onSaved, wizardMode, maxStep = 1 }) {
  const { session } = useAuth()
  const token = session?.access_token

  const isCardSelect = (ft) => ft === 'card_select'
  const hasStringOptions = (ft) => ['select', 'radio', 'chip_multi'].includes(ft)

  const [form, setForm] = useState({
    label:       field?.label       ?? '',
    name:        field?.name        ?? '',
    fieldType:   field?.fieldType   ?? 'text',
    semanticKey: field?.semanticKey ?? 'custom',
    placeholder: field?.placeholder ?? '',
    required:    field?.required    ?? false,
    options:     hasStringOptions(field?.fieldType)
      ? (Array.isArray(field?.options)
          ? field.options.map(o => typeof o === 'string' ? o : o.label).join(', ')
          : '')
      : '',
    cardOptions: isCardSelect(field?.fieldType)
      ? parseCardOptions(field?.options)
      : [{ label: '', description: '' }],
    stepNumber:  field?.stepNumber  ?? 1,
    stepTitle:   field?.stepTitle   ?? '',
  })
  const [nameTouched, setNameTouched] = useState(isEdit)

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

  const mutation = useMutation({
    mutationFn: async (data) => {
      const url = isEdit
        ? `${getApiUrl()}/website/form-fields/${field.id}`
        : `${getApiUrl()}/website/forms/${formId}/fields`
      const res = await companyFetch(url, {
        method: isEdit ? 'PATCH' : 'POST',
        headers,
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const msg = typeof body.error === 'string' ? body.error : body.error?.message || `HTTP ${res.status}`
        throw new Error(msg)
      }
      return res.json()
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Campo actualizado' : 'Campo agregado')
      onSaved()
      onOpenChange(false)
    },
    onError: (err) => toast.error(err.message || 'Error al guardar campo'),
  })

  function handleLabelChange(e) {
    const label = e.target.value
    setForm((f) => ({
      ...f, label,
      ...(!nameTouched && { name: toFieldName(label) }),
    }))
  }

  function buildOptions() {
    if (isCardSelect(form.fieldType)) {
      return form.cardOptions
        .filter(o => o.label.trim())
        .map(o => ({
          value: toFieldName(o.label),
          label: o.label.trim(),
          description: o.description.trim() || undefined,
        }))
    }
    if (hasStringOptions(form.fieldType) && form.options.trim()) {
      return form.options.split(',').map((s) => s.trim()).filter(Boolean)
    }
    return null
  }

  function handleSubmit(e) {
    e.preventDefault()
    const payload = {
      label:       form.label.trim(),
      name:        form.name.trim(),
      fieldType:   form.fieldType,
      semanticKey: form.semanticKey,
      placeholder: form.placeholder.trim() || undefined,
      required:    form.required,
      options:     buildOptions(),
      stepNumber:  wizardMode ? (Number(form.stepNumber) || 1) : 1,
      stepTitle:   wizardMode ? (form.stepTitle.trim() || null) : null,
    }
    mutation.mutate(payload)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 py-2">
      <TextField
        label="Etiqueta"
        value={form.label}
        onChange={handleLabelChange}
        required
        autoFocus
      />
      <TextField
        label="Nombre del campo (clave)"
        value={form.name}
        onChange={(e) => { setNameTouched(true); setForm((f) => ({ ...f, name: e.target.value })) }}
        placeholder="nombre_campo"
        required
      />
      <div className="grid grid-cols-2 gap-3">
        <SelectField
          label="Tipo"
          value={form.fieldType}
          onChange={(v) => setForm((f) => ({ ...f, fieldType: v }))}
          options={FIELD_TYPE_OPTIONS}
        />
        <TextField
          label="Placeholder"
          value={form.placeholder}
          onChange={(e) => setForm((f) => ({ ...f, placeholder: e.target.value }))}
        />
      </div>

      <SelectField
        label="Uso para el lead"
        value={form.semanticKey}
        onChange={(value) => setForm((current) => ({ ...current, semanticKey: value }))}
        options={SEMANTIC_OPTIONS}
      />

      {hasStringOptions(form.fieldType) && (
        <TextField
          label={form.fieldType === 'chip_multi' ? 'Opciones (separadas por coma)' : 'Opciones (separadas por coma)'}
          value={form.options}
          onChange={(e) => setForm((f) => ({ ...f, options: e.target.value }))}
          placeholder="Opcion 1, Opcion 2, Opcion 3"
        />
      )}

      {isCardSelect(form.fieldType) && (
        <CardOptionsEditor
          value={form.cardOptions}
          onChange={(v) => setForm((f) => ({ ...f, cardOptions: v }))}
        />
      )}

      {wizardMode && (
        <div className="rounded-lg border border-[hsl(var(--border))] p-3 space-y-3">
          <p className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wide">Paso del wizard</p>
          <div className="grid grid-cols-2 gap-3">
            <SelectField
              label="Asignar al paso"
              value={String(form.stepNumber ?? 1)}
              onChange={(v) => setForm((f) => ({ ...f, stepNumber: Number(v) }))}
              options={Array.from({ length: maxStep }, (_, i) => ({
                value: String(i + 1),
                label: `Paso ${i + 1}`,
              }))}
            />
            <TextField
              label="Titulo del paso (opcional)"
              value={form.stepTitle}
              onChange={(e) => setForm((f) => ({ ...f, stepTitle: e.target.value }))}
              placeholder="ej. Tu proyecto"
            />
          </div>
        </div>
      )}

      <CheckboxField
        label="Campo obligatorio"
        checked={form.required}
        onChange={(e) => setForm((f) => ({ ...f, required: e.target.checked }))}
      />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
        <Button type="submit" disabled={mutation.isPending || !form.label.trim() || !form.name.trim()}>
          {mutation.isPending ? 'Guardando...' : isEdit ? 'Guardar' : 'Agregar'}
        </Button>
      </DialogFooter>
    </form>
  )
}

function FieldDialog({ formId, field, open, onOpenChange, onSaved, wizardMode, maxStep }) {
  const isEdit = Boolean(field)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Editar campo' : 'Agregar campo'}</DialogTitle>
        </DialogHeader>
        <FieldForm
          formId={formId}
          field={field}
          isEdit={isEdit}
          onOpenChange={onOpenChange}
          onSaved={onSaved}
          wizardMode={wizardMode}
          maxStep={maxStep}
        />
      </DialogContent>
    </Dialog>
  )
}

function SortableField({ field, onEdit, onDelete, wizardMode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: field.id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }
  const TypeIcon = FIELD_TYPES.find((t) => t.value === field.fieldType)?.Icon ?? Type

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 px-3 py-2.5 bg-[hsl(var(--background))] border border-[hsl(var(--border))] rounded-lg group"
    >
      <button {...attributes} {...listeners} className="cursor-grab text-[hsl(var(--muted-foreground))] touch-none">
        <GripVertical size={14} />
      </button>
      <TypeIcon size={14} className="text-[hsl(var(--muted-foreground))] shrink-0" />
      <span className="flex-1 text-sm font-medium">{field.label}</span>
      {field.required && <span className="text-[10px] text-red-500 font-mono">*</span>}
      <span className="text-xs font-mono text-[hsl(var(--muted-foreground))]">{field.fieldType}</span>
      {wizardMode && (
        <span className="text-[10px] rounded-full bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))] px-2 py-0.5 font-semibold">
          Paso {field.stepNumber ?? 1}
        </span>
      )}
      {field.semanticKey && field.semanticKey !== 'custom' && (
        <span className="text-[10px] rounded-full bg-[hsl(var(--muted))] px-2 py-0.5 text-[hsl(var(--muted-foreground))]">
          {SEMANTIC_OPTIONS.find((option) => option.value === field.semanticKey)?.label}
        </span>
      )}
      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={() => onEdit(field)} className="p-1 rounded hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]"><Pencil size={12} /></button>
        <button onClick={() => onDelete(field)} className="p-1 rounded hover:bg-[hsl(var(--muted))] text-[hsl(var(--destructive))]"><Trash2 size={12} /></button>
      </div>
    </div>
  )
}

function StepsBar({ steps, onAdd }) {
  return (
    <div className="rounded-lg border border-violet-500/30 bg-violet-500/5 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-violet-500">WIZARD — Pasos definidos</span>
        <button
          type="button"
          onClick={onAdd}
          className="flex items-center gap-1 text-xs font-medium text-violet-500 hover:text-violet-600 transition-colors px-2 py-1 rounded-md hover:bg-violet-500/10"
        >
          <Plus size={12} /> Agregar paso
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {steps.map((step) => (
          <div
            key={step.number}
            className="flex items-center gap-2 rounded-lg border border-violet-500/20 bg-[hsl(var(--background))] px-3 py-1.5"
          >
            <span className="text-[10px] font-bold text-violet-500 bg-violet-500/10 rounded-full px-1.5 py-0.5">
              {step.number}
            </span>
            <span className="text-xs text-[hsl(var(--foreground))]">
              {step.title || `Paso ${step.number}`}
            </span>
            <span className="text-[10px] text-[hsl(var(--muted-foreground))]">
              {step.fieldCount} campo{step.fieldCount !== 1 ? 's' : ''}
            </span>
          </div>
        ))}
        {steps.length === 0 && (
          <p className="text-xs text-[hsl(var(--muted-foreground))]">
            Sin pasos definidos. Agrega el primero.
          </p>
        )}
      </div>
      <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
        Edita cada campo para asignarlo a un paso. El título del paso se configura por campo.
      </p>
    </div>
  )
}

export default function FormFieldBuilder({ formId, fields = [], onRefresh, wizardMode = false }) {
  const { session } = useAuth()
  const token = session?.access_token

  const [addOpen, setAddOpen] = useState(false)
  const [editField, setEditField] = useState(null)
  const [editOpen, setEditOpen] = useState(false)
  const [localFields, setLocalFields] = useState(fields)
  const [confirmField, setConfirmField] = useState(null)

  const fieldsMaxStep = Math.max(1, ...fields.map(f => f.stepNumber ?? 1))
  const [definedStepCount, setDefinedStepCount] = useState(fieldsMaxStep)

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const reorderMutation = useMutation({
    mutationFn: async (reordered) => {
      const res = await companyFetch(`${getApiUrl()}/website/forms/${formId}/fields/reorder`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: reordered.map((f, i) => ({ id: f.id, sortOrder: i * 10 })) }),
      })
      if (!res.ok) throw new Error('Error al reordenar')
    },
    onSuccess: () => onRefresh(),
    onError: () => toast.error('Error al guardar el orden'),
  })

  const deleteMutation = useMutation({
    mutationFn: async (fieldId) => {
      const res = await companyFetch(`${getApiUrl()}/website/form-fields/${fieldId}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Error al eliminar')
    },
    onSuccess: () => { toast.success('Campo eliminado'); setConfirmField(null); onRefresh() },
    onError: () => { toast.error('Error al eliminar campo'); setConfirmField(null) },
  })

  const displayFields = (localFields.length > 0 ? localFields : fields).filter(Boolean)

  function handleDragEnd({ active, over }) {
    if (!over || active.id === over.id) return
    const oldIndex = displayFields.findIndex((f) => f.id === active.id)
    const newIndex  = displayFields.findIndex((f) => f.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    const reordered = arrayMove(displayFields, oldIndex, newIndex)
    setLocalFields(reordered)
    reorderMutation.mutate(reordered)
  }
  const effectiveMaxStep = wizardMode
    ? Math.max(definedStepCount, ...displayFields.map(f => f.stepNumber ?? 1))
    : 1

  const wizardSteps = wizardMode
    ? Array.from({ length: effectiveMaxStep }, (_, i) => {
        const n = i + 1
        const stepFields = displayFields.filter(f => (f.stepNumber ?? 1) === n)
        const title = stepFields[0]?.stepTitle ?? null
        return { number: n, title, fieldCount: stepFields.length }
      })
    : []

  return (
    <div className="space-y-3">
      {wizardMode && (
        <StepsBar
          steps={wizardSteps}
          onAdd={() => setDefinedStepCount(c => Math.max(c, effectiveMaxStep) + 1)}
        />
      )}
      {displayFields.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[hsl(var(--border))] p-8 text-center">
          <p className="text-[hsl(var(--muted-foreground))] text-sm">No hay campos. Agrega el primer campo.</p>
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={displayFields.map((f) => f.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-1.5">
              {displayFields.map((field) => (
                <SortableField
                  key={field.id}
                  field={field}
                  onEdit={(f) => { setEditField(f); setEditOpen(true) }}
                  onDelete={setConfirmField}
                  wizardMode={wizardMode}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <button
        onClick={() => setAddOpen(true)}
        className="w-full rounded-lg border border-dashed border-[hsl(var(--border))] py-2 text-sm text-[hsl(var(--muted-foreground))] hover:border-[hsl(var(--primary))] hover:text-[hsl(var(--primary))] transition-colors"
      >
        + Agregar campo
      </button>

      <FieldDialog formId={formId} field={null} open={addOpen} onOpenChange={setAddOpen} onSaved={() => { setLocalFields([]); onRefresh() }} wizardMode={wizardMode} maxStep={effectiveMaxStep} />
      <FieldDialog formId={formId} field={editField} open={editOpen} onOpenChange={(v) => { setEditOpen(v); if (!v) setEditField(null) }} onSaved={() => { setLocalFields([]); onRefresh() }} wizardMode={wizardMode} maxStep={effectiveMaxStep} />

      <ConfirmDialog
        open={Boolean(confirmField)}
        onOpenChange={(open) => { if (!open) setConfirmField(null) }}
        title="Eliminar campo"
        description={`Se eliminara permanentemente el campo "${confirmField?.label}". Esta accion no se puede deshacer.`}
        confirmLabel="Eliminar"
        loading={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate(confirmField?.id)}
      />
    </div>
  )
}
