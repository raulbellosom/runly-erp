import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Button, CheckboxField, DateField, DateTimeField, EmptyState, ErrorState, NumberField,
  PublicLinkFrame, SelectField, Skeleton, TagsField, TextField, TextareaField,
} from '@runly/ui'
import { CheckCircle2 } from 'lucide-react'

// Generic public page for Builder public links (component key
// `runly.public:RecordPage`). Renders `schema.publicPage` from the generated
// view: a read-only card of the allowlisted fields and, for submit links, a
// form posted to the module's generated api/public.js.

function formatValue(field, value) {
  if (value === null || value === undefined || value === '') return '—'
  if (field.type === 'boolean') return value ? 'Sí' : 'No'
  if (Array.isArray(value)) return value.map((item) => optionLabel(field, item)).join(', ')
  if (field.type === 'select') return optionLabel(field, value)
  if (field.type === 'date') return new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString('es-MX', { dateStyle: 'medium' })
  if (field.type === 'datetime') return new Date(value).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })
  return String(value)
}

function optionLabel(field, value) {
  return field.options?.find((option) => option.value === value)?.label ?? String(value)
}

function FormInput({ field, value, onChange }) {
  const common = { label: field.label, required: field.required }
  const fromEvent = (event) => onChange(event?.target ? event.target.value : event)
  switch (field.type) {
    case 'textarea':
    case 'markdown':
      return <TextareaField {...common} value={value ?? ''} onChange={fromEvent} />
    case 'number':
    case 'decimal':
      return (
        <NumberField
          {...common}
          allowDecimal={field.type === 'decimal'}
          value={value ?? ''}
          onChange={(event) => {
            const raw = event?.target ? event.target.value : event
            onChange(raw === '' || raw === null || raw === undefined ? '' : Number(raw))
          }}
        />
      )
    case 'boolean':
      return <CheckboxField label={field.label} checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />
    case 'select':
      return <SelectField {...common} options={field.options ?? []} value={value ?? ''} onValueChange={onChange} placeholder="Selecciona una opción" />
    case 'multiselect': {
      const selected = Array.isArray(value) ? value : []
      if (!field.options?.length) return <TagsField {...common} value={selected} onChange={onChange} />
      return (
        <div className="space-y-1.5">
          <p className="text-sm font-medium">{field.label}{field.required ? ' *' : ''}</p>
          <div className="flex flex-wrap gap-2">
            {field.options.map((option) => {
              const active = selected.includes(option.value)
              return (
                <Button key={option.value} type="button" size="sm" variant={active ? 'default' : 'outline'}
                  onClick={() => onChange(active ? selected.filter((item) => item !== option.value) : [...selected, option.value])}>
                  {option.label}
                </Button>
              )
            })}
          </div>
        </div>
      )
    }
    case 'date':
      return <DateField {...common} value={value ?? ''} onChange={fromEvent} />
    case 'datetime':
      return <DateTimeField {...common} value={value ?? ''} onChange={fromEvent} />
    case 'email':
      return <TextField {...common} type="email" value={value ?? ''} onChange={fromEvent} />
    case 'phone':
      return <TextField {...common} type="tel" value={value ?? ''} onChange={fromEvent} />
    default:
      return <TextField {...common} value={value ?? ''} onChange={fromEvent} />
  }
}

export default function PublicRecordPage({ schema, apiBaseUrl, publicLink }) {
  const page = schema?.publicPage ?? {}
  const display = page.display ?? []
  const form = page.form ?? []
  const [values, setValues] = useState({})
  const [honeypot, setHoneypot] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const recordQuery = useQuery({
    queryKey: ['public-link-record', apiBaseUrl],
    enabled: Boolean(apiBaseUrl) && display.length > 0,
    queryFn: async () => {
      const res = await fetch(`${apiBaseUrl}/record`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'No se pudo cargar la información.')
      return json.data
    },
    retry: 1,
  })

  if (!apiBaseUrl) {
    return <div className="p-6"><EmptyState title="Enlace incompleto" description="Abre el enlace completo que te compartieron." /></div>
  }

  async function submit(event) {
    event.preventDefault()
    const missing = form.find((field) => field.required && field.type !== 'boolean' && (values[field.key] === undefined || values[field.key] === '' || (Array.isArray(values[field.key]) && !values[field.key].length)))
    if (missing) { setError(`El campo ${missing.label} es requerido.`); return }
    setSending(true)
    setError('')
    try {
      const res = await fetch(`${apiBaseUrl}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, _hp: honeypot }),
      })
      const json = await res.json().catch(() => ({}))
      if (res.status === 410) throw new Error('Este enlace ya no admite más envíos.')
      if (res.status === 429) throw new Error('Demasiados intentos. Espera un momento e intenta de nuevo.')
      if (!res.ok) throw new Error(json.error ?? 'No se pudo enviar. Intenta de nuevo.')
      setDone(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <PublicLinkFrame publicLink={publicLink} title={page.title}>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold">{page.title}</h1>
          {page.description ? <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">{page.description}</p> : null}
        </div>

        {display.length > 0 ? (
          recordQuery.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : recordQuery.isError ? (
            <ErrorState title="No se pudo cargar la información" description={recordQuery.error.message} onRetry={() => recordQuery.refetch()} />
          ) : recordQuery.data ? (
            <dl className="grid gap-3 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 sm:grid-cols-2">
              {display.map((field) => (
                <div key={field.key} className="min-w-0">
                  <dt className="text-xs text-[hsl(var(--muted-foreground))]">{field.label}</dt>
                  <dd className="break-words text-sm">{formatValue(field, recordQuery.data[field.key])}</dd>
                </div>
              ))}
            </dl>
          ) : null
        ) : null}

        {page.mode === 'submit' ? (
          done ? (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 text-center">
              <CheckCircle2 className="h-8 w-8 text-[--color-primary]" />
              <p className="text-sm">{page.successMessage}</p>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4" noValidate>
              {form.map((field) => (
                <FormInput key={field.key} field={field} value={values[field.key]} onChange={(next) => setValues((prev) => ({ ...prev, [field.key]: next }))} />
              ))}
              {/* Honeypot: hidden from people, filled by bots. */}
              <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
                <TextField label="Sitio web" tabIndex={-1} autoComplete="off" value={honeypot} onChange={(event) => setHoneypot(event.target.value)} />
              </div>
              {error ? <p className="text-sm text-[hsl(var(--destructive))]">{error}</p> : null}
              <Button type="submit" disabled={sending} className="w-full sm:w-auto">
                {sending ? 'Enviando...' : page.submitLabel}
              </Button>
            </form>
          )
        ) : null}
      </div>
    </PublicLinkFrame>
  )
}
