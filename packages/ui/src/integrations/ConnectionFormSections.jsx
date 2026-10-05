import {
  Button, DatePickerField, FormSection, IconGlyph, SelectField, SwitchField, TextareaField, TextField,
} from '../index.js'
import { AlertTriangle, Lock, Plug } from 'lucide-react'
import { displayValue, EDITABLE_TYPES } from './connectionFormat.js'

// Editable connection sections inside a core form (spec
// 2026-10-03-rme3-module-platform-v2 §8.2). State and save live in
// useConnectionForm; the core form sends form.payload() with its own request.

function sectionIcon(section) {
  const name = section.icon ? String(section.icon).replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/([A-Za-z])(\d)/g, '$1-$2').toLowerCase() : null
  return name ? function ModuleGlyph(props) { return <IconGlyph name={name} {...props} /> } : Plug
}

function FieldInput({ field, value, error, onChange }) {
  const common = { label: field.label, required: field.required, error }
  switch (field.type) {
    case 'textarea':
    case 'markdown':
      return <TextareaField {...common} className="md:col-span-2" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
    case 'number':
    case 'decimal':
      return <TextField {...common} type="number" value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)} />
    case 'email':
      return <TextField {...common} type="email" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
    case 'date':
      return <DatePickerField {...common} value={value ? String(value).slice(0, 10) : undefined} onChange={(v) => onChange(v ?? null)} />
    case 'boolean':
      return <SwitchField label={field.label} checked={Boolean(value)} onChange={onChange} error={error} />
    case 'select':
      return (
        <SelectField
          {...common}
          options={(field.options ?? []).map((o) => (typeof o === 'object' ? o : { value: o, label: String(o) }))}
          value={value ?? undefined}
          onValueChange={onChange}
        />
      )
    default:
      return <TextField {...common} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
  }
}

function ReadOnlyValue({ field, value }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{field.label}</p>
      <p className="text-sm text-foreground">{displayValue(field, value)}</p>
    </div>
  )
}

// variant "card" (standalone FormSection cards) or "plain" (titled groups,
// for use inside an existing form section card).
function PlainSection({ title, icon: Icon, description, actions, children }) {
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground">{Icon && <Icon className="h-4 w-4 text-primary" />}{title}</p>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
        {actions}
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{children}</div>
    </div>
  )
}

export function ConnectionFormSections({ form, variant = "card" }) {
  if (!form || form.isLoading || !form.sections.length) return null
  const Section = variant === "plain" ? PlainSection : FormSection
  return (
    <div className={variant === "plain" ? "space-y-6" : "space-y-4"}>
      {form.sections.map((section) => {
        const conflict = form.conflict === section.connectionId || form.conflict === true
        return (
          <Section
            key={section.connectionId}
            title={section.label}
            icon={sectionIcon(section)}
            description={`Datos de ${section.moduleName}`}
            actions={!section.editable ? <Lock className="h-4 w-4 text-muted-foreground" aria-label="Solo lectura" /> : null}
          >
            {conflict && (
              <div className="flex flex-col gap-2 rounded-xl bg-amber-500/10 p-3 text-sm text-amber-800 sm:flex-row sm:items-center md:col-span-2 dark:text-amber-300">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span className="flex-1">Otra persona modificó estos datos mientras editabas.</span>
                <Button type="button" size="sm" variant="outline" onClick={form.reset}>Recargar</Button>
              </div>
            )}
            {!section.editable && section.readOnlyReason && (
              <p className="text-sm text-muted-foreground md:col-span-2">{section.readOnlyReason}</p>
            )}
            {section.fields.map((field) => {
              const value = form.valueOf(section, field.name)
              if (!section.editable || !EDITABLE_TYPES.has(field.type)) return <ReadOnlyValue key={field.name} field={field} value={value} />
              return (
                <FieldInput
                  key={field.name}
                  field={field}
                  value={value}
                  error={form.errors[`${section.connectionId}.${field.name}`]}
                  onChange={(next) => form.setFieldValue(section.connectionId, field.name, next)}
                />
              )
            })}
          </Section>
        )
      })}
    </div>
  )
}
