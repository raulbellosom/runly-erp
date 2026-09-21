import { useState } from 'react'
import { Type, Mail, Phone, AlignLeft, List, CheckSquare, Hash, Calendar, ToggleLeft, ChevronLeft, ChevronRight, LayoutGrid, Tags } from 'lucide-react'

const TYPE_ICON = {
  text: Type, email: Mail, tel: Phone, phone: Phone,
  textarea: AlignLeft, select: List, checkbox: CheckSquare,
  number: Hash, date: Calendar, radio: ToggleLeft,
  chip_multi: Tags, card_select: LayoutGrid,
}

const FULL_WIDTH = new Set(['textarea', 'chip_multi', 'card_select'])
const FULL_WIDTH_SEMANTIC = new Set(['message', 'description', 'comments'])

function isFullWidth(f) {
  return FULL_WIDTH.has(f.fieldType) || FULL_WIDTH_SEMANTIC.has(f.semanticKey)
}

function PreviewField({ field }) {
  const [value, setValue] = useState('')
  const Icon = TYPE_ICON[field.fieldType] ?? Type

  const inputClass = [
    'w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))]',
    'px-3 py-2.5 text-sm text-[hsl(var(--foreground))] outline-none',
    'focus:ring-2 focus:ring-[hsl(var(--primary))] focus:border-transparent',
    'transition-colors placeholder:text-[hsl(var(--muted-foreground))]',
  ].join(' ')

  const label = (
    <label className="block text-sm font-medium text-[hsl(var(--foreground))] mb-1.5">
      {field.label}
      {field.required && <span className="text-red-500 ml-1" aria-hidden="true">*</span>}
    </label>
  )

  if (field.fieldType === 'textarea') {
    return (
      <div>
        {label}
        <textarea
          className={`${inputClass} min-h-[100px] resize-none`}
          placeholder={field.placeholder ?? undefined}
          value={value}
          onChange={e => setValue(e.target.value)}
          rows={4}
        />
      </div>
    )
  }

  if (field.fieldType === 'select') {
    return (
      <div>
        {label}
        <select
          className={inputClass}
          value={value}
          onChange={e => setValue(e.target.value)}
        >
          <option value="">{field.placeholder ?? 'Selecciona una opción'}</option>
          {(field.options ?? []).map(opt => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      </div>
    )
  }

  if (field.fieldType === 'radio') {
    return (
      <div>
        {label}
        <div className="space-y-2">
          {(field.options ?? []).map(opt => (
            <label key={opt} className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                name={`preview-${field.name}`}
                value={opt}
                checked={value === opt}
                onChange={() => setValue(opt)}
                className="accent-[hsl(var(--primary))]"
              />
              {opt}
            </label>
          ))}
        </div>
      </div>
    )
  }

  if (field.fieldType === 'checkbox') {
    return (
      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input
          type="checkbox"
          checked={value === 'true'}
          onChange={e => setValue(String(e.target.checked))}
          className="accent-[hsl(var(--primary))] w-4 h-4"
        />
        <span className="text-[hsl(var(--foreground))]">
          {field.placeholder ?? field.label}
          {field.required && <span className="text-red-500 ml-1">*</span>}
        </span>
      </label>
    )
  }

  if (field.fieldType === 'chip_multi') {
    const selected = value ? value.split(',').filter(Boolean) : []
    const opts = (field.options ?? []).map(o => typeof o === 'string' ? o : o.label)
    return (
      <div>
        {label}
        <div className="flex flex-wrap gap-2">
          {opts.map(opt => {
            const active = selected.includes(opt)
            return (
              <button
                key={opt}
                type="button"
                onClick={() => {
                  const next = active ? selected.filter(s => s !== opt) : [...selected, opt]
                  setValue(next.join(','))
                }}
                className={[
                  'px-3 py-1.5 rounded-full text-sm border transition-colors',
                  active
                    ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]'
                    : 'border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--foreground))] hover:border-[hsl(var(--primary)/0.5)]',
                ].join(' ')}
              >
                {opt}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  if (field.fieldType === 'card_select') {
    const opts = (field.options ?? []).map(o =>
      typeof o === 'string' ? { value: o, label: o, description: '' } : o
    )
    return (
      <div>
        {label}
        <div className="grid grid-cols-2 gap-2">
          {opts.map(opt => {
            const active = value === (opt.value ?? opt.label)
            return (
              <button
                key={opt.value ?? opt.label}
                type="button"
                onClick={() => setValue(active ? '' : (opt.value ?? opt.label))}
                className={[
                  'text-left rounded-lg border p-3 transition-colors',
                  active
                    ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.06)]'
                    : 'border-[hsl(var(--border))] bg-[hsl(var(--background))]',
                ].join(' ')}
              >
                <p className={`text-sm font-semibold ${active ? 'text-[hsl(var(--primary))]' : 'text-[hsl(var(--foreground))]'}`}>
                  {opt.label}
                </p>
                {opt.description && (
                  <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5 leading-snug">{opt.description}</p>
                )}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div>
      {label}
      <input
        type={field.fieldType === 'phone' ? 'tel' : field.fieldType}
        className={inputClass}
        placeholder={field.placeholder ?? undefined}
        value={value}
        onChange={e => setValue(e.target.value)}
      />
    </div>
  )
}

function buildRows(fields) {
  const rows = []
  let i = 0
  while (i < fields.length) {
    const current = fields[i]
    if (isFullWidth(current)) {
      rows.push([current])
      i++
    } else {
      const next = fields[i + 1]
      if (next && !isFullWidth(next)) {
        rows.push([current, next])
        i += 2
      } else {
        rows.push([current])
        i++
      }
    }
  }
  return rows
}

function FlatPreview({ form, fields }) {
  const rows = buildRows(fields)
  return (
    <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 space-y-4 max-w-xl mx-auto">
      {form.description && (
        <p className="text-sm text-[hsl(var(--muted-foreground))] leading-relaxed">{form.description}</p>
      )}
      <div className="space-y-4">
        {rows.map((row, ri) => (
          <div key={ri} className={row.length === 2 ? 'grid grid-cols-2 gap-4' : ''}>
            {row.map(f => <PreviewField key={f.id} field={f} />)}
          </div>
        ))}
      </div>
      <button
        type="button"
        disabled
        className="w-full rounded-lg bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] py-2.5 text-sm font-semibold opacity-80 cursor-not-allowed"
      >
        {form.submitLabel || 'Enviar'}
      </button>
      <p className="text-xs text-center text-[hsl(var(--muted-foreground))]">
        Vista previa — los envíos no se procesan aquí
      </p>
    </div>
  )
}

function WizardPreview({ form, fields }) {
  // Group fields by stepNumber, preserve order
  const stepsMap = new Map()
  for (const field of fields) {
    const n = field.stepNumber ?? 1
    if (!stepsMap.has(n)) stepsMap.set(n, { number: n, title: field.stepTitle ?? null, fields: [] })
    stepsMap.get(n).fields.push(field)
  }
  const steps = [...stepsMap.values()].sort((a, b) => a.number - b.number)
  const total = steps.length

  const [current, setCurrent] = useState(0)

  if (total === 0) return null

  const step = steps[current]
  const rows = buildRows(step.fields)
  const isLast = current === total - 1

  return (
    <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 space-y-5 max-w-xl mx-auto">
      {/* Stepper header */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-[hsl(var(--muted-foreground))] font-medium">
            Paso {current + 1} de {total}
          </span>
          {step.title && (
            <span className="text-sm font-semibold text-[hsl(var(--foreground))]">{step.title}</span>
          )}
        </div>
        {/* Progress bar */}
        <div className="w-full bg-[hsl(var(--muted))] rounded-full h-1.5">
          <div
            className="bg-[hsl(var(--primary))] h-1.5 rounded-full transition-all duration-300"
            style={{ width: `${((current + 1) / total) * 100}%` }}
          />
        </div>
        {/* Step dots */}
        <div className="flex items-center gap-2 justify-center">
          {steps.map((s, i) => (
            <button
              key={s.number}
              type="button"
              onClick={() => setCurrent(i)}
              className={[
                'rounded-full transition-all duration-200',
                i === current
                  ? 'w-6 h-2 bg-[hsl(var(--primary))]'
                  : i < current
                    ? 'w-2 h-2 bg-[hsl(var(--primary))]/50'
                    : 'w-2 h-2 bg-[hsl(var(--muted-foreground))]/30',
              ].join(' ')}
            />
          ))}
        </div>
      </div>

      {form.description && current === 0 && (
        <p className="text-sm text-[hsl(var(--muted-foreground))] leading-relaxed">{form.description}</p>
      )}

      {/* Step fields */}
      <div className="space-y-4">
        {rows.map((row, ri) => (
          <div key={ri} className={row.length === 2 ? 'grid grid-cols-2 gap-4' : ''}>
            {row.map(f => <PreviewField key={f.id} field={f} />)}
          </div>
        ))}
      </div>

      {/* Navigation */}
      <div className="flex items-center gap-3">
        {current > 0 && (
          <button
            type="button"
            onClick={() => setCurrent(c => c - 1)}
            className="flex items-center gap-1 px-4 py-2 rounded-lg border border-[hsl(var(--border))] text-sm font-medium text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors"
          >
            <ChevronLeft size={15} /> Anterior
          </button>
        )}
        <div className="flex-1" />
        {isLast ? (
          <button
            type="button"
            disabled
            className="flex items-center gap-1 px-4 py-2 rounded-lg bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] text-sm font-semibold opacity-80 cursor-not-allowed"
          >
            {form.submitLabel || 'Enviar'}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setCurrent(c => c + 1)}
            className="flex items-center gap-1 px-4 py-2 rounded-lg bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] text-sm font-semibold hover:opacity-90 transition-opacity"
          >
            Siguiente <ChevronRight size={15} />
          </button>
        )}
      </div>

      <p className="text-xs text-center text-[hsl(var(--muted-foreground))]">
        Vista previa — los envíos no se procesan aquí
      </p>
    </div>
  )
}

export default function FormPreview({ form }) {
  if (!form) return null

  const fields = [...(form.fields ?? [])].sort((a, b) => a.sortOrder - b.sortOrder)

  if (fields.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[hsl(var(--border))] p-10 text-center">
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          Este formulario no tiene campos. Agrega campos en la pestaña Campos.
        </p>
      </div>
    )
  }

  if (form.wizardMode) {
    return <WizardPreview form={form} fields={fields} />
  }

  return <FlatPreview form={form} fields={fields} />
}
