import { useEffect, useMemo, useState } from 'react'
import {
  CheckboxField,
  ComboboxField,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Button,
  NumberField,
  SelectField,
  SwitchField,
  TextareaField,
  TextField,
} from '@runly/ui'
import {
  ASSIGNMENT_TYPES,
  CATALOGS,
  STATION_TYPES,
  VOUCHER_TYPES,
  createInitialForm,
} from '../lib/catalog-config.js'

function relationOptions(items = [], label) {
  return items.flatMap((item) => item.enabled ? [{ value: item.id, label: label(item) }] : [])
}

function cleanPayload(resource, form) {
  const payload = { ...form }
  delete payload.id
  delete payload.enabled
  delete payload.created_at
  delete payload.updated_at
  delete payload.site_name
  delete payload.station_name
  delete payload.user_name
  delete payload.user_email
  if ('address_text' in payload) payload.address_text = payload.address_text?.trim() || null
  if ('location_note' in payload) payload.location_note = payload.location_note?.trim() || null
  if (resource === 'materials') {
    payload.allowed_modes = Array.isArray(payload.allowed_modes) ? payload.allowed_modes : []
    payload.density_kg_m3 = payload.density_kg_m3 === '' ? null : Number(payload.density_kg_m3)
    payload.catalog_product_id = payload.catalog_product_id || null
  }
  if (resource === 'series') {
    payload.next_number = Number(payload.next_number)
    payload.padding = Number(payload.padding)
  }
  return payload
}

export default function CatalogEditorDialog({ open, onOpenChange, resource, record, initialValues, setup, onSave, saving }) {
  const [form, setForm] = useState(() => createInitialForm(resource, record, initialValues))
  const config = CATALOGS[resource]

  useEffect(() => {
    if (open) setForm(createInitialForm(resource, record, initialValues))
  }, [initialValues, open, record, resource])

  const sites = useMemo(() => relationOptions(setup.sites, (item) => `${item.code} · ${item.name}`), [setup.sites])
  const stations = useMemo(() => relationOptions(setup.stations, (item) => `${item.site_name} · ${item.name}`), [setup.stations])
  const users = useMemo(() => (setup.users ?? []).map((item) => ({ value: item.id, label: item.display_name || item.email })), [setup.users])

  function setValue(key, value) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function toggleMode(mode, checked) {
    setForm((current) => ({
      ...current,
      allowed_modes: checked
        ? [...new Set([...(Array.isArray(current.allowed_modes) ? current.allowed_modes : []), mode])]
        : (Array.isArray(current.allowed_modes) ? current.allowed_modes : []).filter((item) => item !== mode),
    }))
  }

  function submit(event) {
    event.preventDefault()
    onSave(cleanPayload(resource, form))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{record ? `Editar ${config.singular}` : config.createLabel}</DialogTitle>
          <DialogDescription>{config.description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4 py-1">
          {resource === 'sites' && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField label="Código" value={form.code} onChange={(event) => setValue('code', event.target.value)} placeholder="MINA-NORTE" required />
                <TextField label="Nombre" value={form.name} onChange={(event) => setValue('name', event.target.value)} placeholder="Mina Norte" required />
              </div>
              <TextField label="Zona horaria" value={form.timezone} onChange={(event) => setValue('timezone', event.target.value)} required />
              <TextareaField label="Dirección o referencia" value={form.address_text ?? ''} onChange={(event) => setValue('address_text', event.target.value)} rows={3} />
            </>
          )}

          {resource === 'stations' && (
            <>
              <ComboboxField label="Sitio" value={form.site_id} onChange={(value) => setValue('site_id', value)} options={sites} placeholder="Buscar sitio..." searchPlaceholder="Buscar sitio..." required />
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField label="Código" value={form.code} onChange={(event) => setValue('code', event.target.value)} placeholder="BASC-01" required />
                <SelectField label="Tipo de estación" value={form.station_type} onChange={(value) => setValue('station_type', value)} options={STATION_TYPES} required />
              </div>
              <TextField label="Nombre" value={form.name} onChange={(event) => setValue('name', event.target.value)} placeholder="Báscula principal" required />
              <TextareaField label="Ubicación física" value={form.location_note ?? ''} onChange={(event) => setValue('location_note', event.target.value)} rows={2} />
            </>
          )}

          {resource === 'assignments' && (
            <>
              <ComboboxField label="Estación" value={form.station_id} onChange={(value) => setValue('station_id', value)} options={stations} placeholder="Buscar estación..." searchPlaceholder="Buscar estación..." required />
              <ComboboxField label="Usuario de Runly" value={form.user_id} onChange={(value) => setValue('user_id', value)} options={users} placeholder="Buscar usuario..." searchPlaceholder="Buscar usuario..." required />
              <SelectField label="Responsabilidad" value={form.assignment_type} onChange={(value) => setValue('assignment_type', value)} options={ASSIGNMENT_TYPES} required />
              <SwitchField
                label="Recibe alertas de salida"
                description="Envía a este usuario las solicitudes de revisión de salida."
                checked={Boolean(form.receives_exit_alerts)}
                onChange={(value) => setValue('receives_exit_alerts', value)}
              />
            </>
          )}

          {resource === 'materials' && (
            <>
              <ComboboxField label="Sitio" value={form.site_id} onChange={(value) => setValue('site_id', value)} options={sites} placeholder="Buscar sitio..." searchPlaceholder="Buscar sitio..." required />
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField label="Código" value={form.code} onChange={(event) => setValue('code', event.target.value)} placeholder="GRAVA-34" required />
                <TextField label="Nombre" value={form.name} onChange={(event) => setValue('name', event.target.value)} placeholder="Grava 3/4" required />
              </div>
              <div className="rounded-2xl border border-border bg-muted/30 p-4">
                <p className="mb-3 text-sm font-medium">Formas de medición</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <CheckboxField label="Metros cúbicos (m³)" checked={(form.allowed_modes ?? []).includes('M3')} onChange={(event) => toggleMode('M3', event.target.checked)} />
                  <CheckboxField label="Toneladas" checked={(form.allowed_modes ?? []).includes('TONS')} onChange={(event) => toggleMode('TONS', event.target.checked)} />
                </div>
              </div>
              <NumberField label="Densidad informativa" suffix="kg/m³" value={form.density_kg_m3} onChange={(event) => setValue('density_kg_m3', event.target.value)} min="0.01" step="0.01" hint="Opcional; no sustituye el pesaje real." />
            </>
          )}

          {resource === 'series' && (
            <>
              <ComboboxField label="Sitio" value={form.site_id} onChange={(value) => setValue('site_id', value)} options={sites} placeholder="Buscar sitio..." searchPlaceholder="Buscar sitio..." required />
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectField label="Tipo de vale" value={form.voucher_type} onChange={(value) => setValue('voucher_type', value)} options={VOUCHER_TYPES} required />
                <TextField label="Prefijo" value={form.prefix} onChange={(event) => setValue('prefix', event.target.value)} placeholder="BAS" required />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <NumberField label="Siguiente número" value={form.next_number} onChange={(event) => setValue('next_number', event.target.value)} min="1" step="1" required />
                <NumberField label="Dígitos" value={form.padding} onChange={(event) => setValue('padding', event.target.value)} min="1" max="12" step="1" required />
              </div>
              <p className="rounded-2xl bg-muted/60 px-4 py-3 text-sm text-muted-foreground">
                Vista previa: <span className="font-mono font-medium text-foreground">{String(form.prefix || 'VAL').toUpperCase()}-{String(form.next_number || 1).padStart(Number(form.padding) || 1, '0')}</span>
              </p>
            </>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" loading={saving} disabled={saving}>Guardar</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
