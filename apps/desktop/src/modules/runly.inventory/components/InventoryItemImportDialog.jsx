import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  Badge, Button, CheckboxField, DataTable, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
  ErrorState, ImportStepIndicator, SelectField,
} from '@runly/ui'
import { Download, FileSpreadsheet, ListChecks, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../../auth/AuthProvider'
import { useActiveCompany } from '../../../company/ActiveCompanyProvider'
import { getApiUrl } from '../../../lib/runtimeConfig.js'
import { intakeRequest } from '../lib/intake.js'

const STEPS = [
  { key: 'file', label: 'Archivo', icon: Upload },
  { key: 'mapping', label: 'Relacionar columnas', icon: ListChecks },
  { key: 'preview', label: 'Vista previa', icon: FileSpreadsheet },
]
const NONE = '__none__'
const STATUS = {
  new: { label: 'Nuevo', variant: 'success' },
  exists: { label: 'Ya existe', variant: 'outline' },
  error: { label: 'Error', variant: 'destructive' },
}
const COLUMNS = [
  { accessorKey: 'line', header: 'Fila' },
  { id: 'status', header: 'Estado', accessorFn: (r) => STATUS[r.status].label,
    cell: ({ row }) => <Badge variant={STATUS[row.original.status].variant}>{STATUS[row.original.status].label}</Badge> },
  { id: 'name', header: 'Nombre', accessorFn: (r) => r.data?.name ?? '' },
  { id: 'serial', header: 'Serie', accessorFn: (r) => r.data?.serialNumber ?? '' },
  { accessorKey: 'message', header: 'Detalle' },
]

// Spreadsheet import for inventory items without AI: the user relates each
// file column to an item field, reviews the preview, then imports.
export function InventoryItemImportDialog({ open, onOpenChange, onImported }) {
  const { session } = useAuth()
  const { activeCompanyId } = useActiveCompany()
  const qc = useQueryClient()
  const token = session?.access_token
  const fileRef = useRef(null)
  const [step, setStep] = useState('file')
  const [parsed, setParsed] = useState(null)
  const [mapping, setMapping] = useState({})
  const [preview, setPreview] = useState(null)
  const [createMissing, setCreateMissing] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const call = (path, body) => intakeRequest({ apiBaseUrl: getApiUrl(), token, companyId: activeCompanyId, path: `/inventory/item-import${path}`, body })

  function close(next) {
    if (!next) { setStep('file'); setParsed(null); setMapping({}); setPreview(null); setError(''); setCreateMissing(true) }
    onOpenChange(next)
  }

  async function downloadTemplate() {
    try {
      const res = await fetch(`${getApiUrl()}/inventory/item-import/template`, { headers: { Authorization: `Bearer ${token}`, 'X-Runly-Company-Id': activeCompanyId } })
      if (!res.ok) throw new Error('No se pudo descargar la plantilla.')
      const url = URL.createObjectURL(await res.blob())
      const link = document.createElement('a')
      link.href = url
      link.download = 'plantilla-activos.xlsx'
      link.click()
      URL.revokeObjectURL(url)
    } catch (err) { toast.error(err.message) }
  }

  async function handleFile(file) {
    if (fileRef.current) fileRef.current.value = ''
    if (!file) return
    setBusy(true); setError('')
    try {
      const form = new FormData()
      form.append('file', file)
      const data = await call('/parse', form)
      if (!data.rows.length) throw new Error('El archivo no tiene filas con datos.')
      setParsed({ ...data, fileName: file.name })
      setMapping(data.mapping ?? {})
      setStep('mapping')
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  async function runPreview(missing = createMissing) {
    setBusy(true); setError('')
    try {
      setPreview(await call('/preview', { rows: parsed.rows, mapping, createMissing: missing }))
      setStep('preview')
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  async function toggleMissing(next) {
    setCreateMissing(next)
    await runPreview(next)
  }

  async function commit() {
    setBusy(true); setError('')
    try {
      const result = await call('/commit', { rows: parsed.rows, mapping, createMissing })
      toast.success(`${result.created} activos creados, ${result.skipped} omitidos${result.failed ? `, ${result.failed} con error` : ''}.`)
      await qc.invalidateQueries({ queryKey: ['inventory'] })
      onImported?.(result)
      close(false)
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  const headerOptions = [{ value: NONE, label: 'No importar' }, ...(parsed?.headers ?? []).map((h) => ({ value: h, label: h }))]
  const sample = (header) => parsed?.rows.find((row) => row[header])?.[header] ?? ''
  const usedHeaders = new Set(Object.values(mapping).filter(Boolean))
  const missing = preview ? [
    ...preview.missing.types.map((n) => `tipo «${n}»`),
    ...preview.missing.brands.map((n) => `marca «${n}»`),
    ...preview.missing.locations.map((n) => `ubicación «${n}»`),
  ] : []
  const creatable = preview?.counts.new ?? 0

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent scrollable size="xl">
        <DialogHeader>
          <DialogTitle>Importar activos</DialogTitle>
          <DialogDescription>Carga un CSV o Excel con tus activos y relaciona cada columna con un campo del inventario.</DialogDescription>
        </DialogHeader>
        <ImportStepIndicator steps={STEPS} current={step} className="shrink-0" />
        <div className="mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-0.5">
          {step === 'file' ? (
            <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-[hsl(var(--border))] p-6">
              <input ref={fileRef} type="file" accept=".csv,.xlsx" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={() => fileRef.current?.click()} disabled={busy}>
                  <Upload className="mr-1.5 h-3.5 w-3.5" />{busy ? 'Leyendo archivo...' : 'Elegir archivo'}
                </Button>
                <Button type="button" variant="outline" onClick={downloadTemplate}><Download className="mr-1.5 h-3.5 w-3.5" />Plantilla Excel</Button>
              </div>
              <p className="text-xs text-[hsl(var(--muted-foreground))]">CSV o Excel (.xlsx), hasta 2,000 filas y 5 MB. La primera fila debe tener los encabezados; cualquier nombre de columna sirve.</p>
            </div>
          ) : null}

          {step === 'mapping' && parsed ? (
            <div className="space-y-3">
              <p className="text-sm text-[hsl(var(--muted-foreground))]">
                {parsed.fileName}: {parsed.rows.length} filas. Elige qué columna del archivo corresponde a cada campo.
              </p>
              <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
                {parsed.fields.map((field) => {
                  const current = mapping[field.key] ?? NONE
                  const options = headerOptions.filter((o) => o.value === NONE || o.value === current || !usedHeaders.has(o.value))
                  const example = current !== NONE ? sample(current) : ''
                  return (
                    <SelectField key={field.key} label={field.label} required={field.required} value={current} options={options}
                      hint={example ? `Ejemplo: ${example}` : undefined}
                      error={field.required && current === NONE ? 'Obligatorio' : undefined}
                      onValueChange={(v) => setMapping((m) => ({ ...m, [field.key]: v === NONE ? undefined : v }))} />
                  )
                })}
              </div>
            </div>
          ) : null}

          {step === 'preview' && preview ? (
            <>
              <div className="flex flex-wrap gap-2">
                <Badge variant="success">{preview.counts.new} nuevos</Badge>
                <Badge variant="outline">{preview.counts.exists} ya existen</Badge>
                <Badge variant="destructive">{preview.counts.error} con error</Badge>
              </div>
              {missing.length > 0 ? (
                <CheckboxField
                  label={`Crear lo que falta: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ` y ${missing.length - 5} más` : ''}`}
                  checked={createMissing}
                  disabled={busy}
                  onChange={(e) => toggleMissing(e.target.checked)}
                />
              ) : null}
              <DataTable columns={COLUMNS} data={preview.rows} pageSize={20} getRowId={(row) => String(row.line)} emptyTitle="El archivo no tiene filas" />
            </>
          ) : null}

          {error ? <ErrorState title="No se pudo procesar el archivo" description={error} /> : null}
        </div>
        <DialogFooter className="shrink-0">
          {step === 'mapping' ? <Button type="button" variant="ghost" onClick={() => setStep('file')}>Cambiar archivo</Button> : null}
          {step === 'preview' ? <Button type="button" variant="ghost" onClick={() => setStep('mapping')}>Volver al mapeo</Button> : null}
          <Button type="button" variant="ghost" onClick={() => close(false)}>Cancelar</Button>
          {step === 'mapping' ? (
            <Button type="button" disabled={busy || !mapping.name} onClick={() => runPreview()}>{busy ? 'Analizando...' : 'Ver vista previa'}</Button>
          ) : null}
          {step === 'preview' ? (
            <Button type="button" disabled={busy || creatable === 0} onClick={commit}>{busy ? 'Importando...' : `Importar ${creatable}`}</Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
