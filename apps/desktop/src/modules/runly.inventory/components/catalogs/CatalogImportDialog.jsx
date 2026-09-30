import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  Badge, Button, CheckboxField, DataTable, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
  ErrorState, ImportStepIndicator,
} from '@runly/ui'
import { Download, FileSpreadsheet, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../../../auth/AuthProvider'
import { useActiveCompany } from '../../../../company/ActiveCompanyProvider'
import { getApiUrl } from '../../../../lib/runtimeConfig.js'
import { intakeRequest } from '../../lib/intake.js'

const STEPS = [
  { key: 'template', label: 'Plantilla', icon: Download },
  { key: 'file', label: 'Archivo', icon: Upload },
  { key: 'preview', label: 'Vista previa', icon: FileSpreadsheet },
]
const STATUS = {
  new: { label: 'Nuevo', variant: 'success' },
  exists: { label: 'Ya existe', variant: 'outline' },
  error: { label: 'Error', variant: 'destructive' },
}
const COLUMNS = [
  { accessorKey: 'line', header: 'Fila' },
  { id: 'status', header: 'Estado', accessorFn: (r) => STATUS[r.status].label,
    cell: ({ row }) => <Badge variant={STATUS[row.original.status].variant}>{STATUS[row.original.status].label}</Badge> },
  { id: 'name', header: 'Nombre', accessorFn: (r) => r.data?.nombre ?? '' },
  { accessorKey: 'message', header: 'Detalle' },
]

export function CatalogImportDialog({ catalog, title, open, onOpenChange }) {
  const { session } = useAuth()
  const { activeCompanyId } = useActiveCompany()
  const qc = useQueryClient()
  const token = session?.access_token
  const fileRef = useRef(null)
  const lastFile = useRef(null)
  const [step, setStep] = useState('template')
  const [preview, setPreview] = useState(null)
  const [createMissing, setCreateMissing] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const base = `/inventory/import/${catalog}`
  const call = (path, body) => intakeRequest({ apiBaseUrl: getApiUrl(), token, companyId: activeCompanyId, path: `${base}${path}`, body })

  function close(next) {
    if (!next) { setStep('template'); setPreview(null); setError(''); setCreateMissing(true); lastFile.current = null }
    onOpenChange(next)
  }

  async function download(format) {
    try {
      const res = await fetch(`${getApiUrl()}${base}/template?format=${format}`, { headers: { Authorization: `Bearer ${token}`, 'X-Runly-Company-Id': activeCompanyId } })
      if (!res.ok) throw new Error('No se pudo descargar la plantilla.')
      const url = URL.createObjectURL(await res.blob())
      const link = document.createElement('a')
      link.href = url
      link.download = `plantilla-${catalog}.${format}`
      link.click()
      URL.revokeObjectURL(url)
      setStep('file')
    } catch (err) { toast.error(err.message) }
  }

  async function runPreview(file, missing) {
    setBusy(true); setError('')
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('createMissing', String(missing))
      setPreview(await call('/preview', form))
      setStep('preview')
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  async function handleFile(file) {
    if (fileRef.current) fileRef.current.value = ''
    if (!file) return
    lastFile.current = file
    await runPreview(file, createMissing)
  }

  async function toggleMissing(next) {
    setCreateMissing(next)
    if (lastFile.current) await runPreview(lastFile.current, next)
  }

  async function commit() {
    setBusy(true); setError('')
    try {
      const result = await call('/commit', { rows: preview.rows.map((row) => row.data), createMissing })
      toast.success(`${result.created} creados, ${result.skipped} omitidos${result.failed ? `, ${result.failed} con error` : ''}.`)
      await qc.invalidateQueries({ queryKey: ['inventory'] })
      close(false)
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  const missing = preview ? [...preview.missing.types.map((n) => `tipo «${n}»`), ...preview.missing.brands.map((n) => `marca «${n}»`)] : []
  const creatable = preview?.counts.new ?? 0

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent scrollable size="lg">
        <DialogHeader>
          <DialogTitle>Importar {title}</DialogTitle>
          <DialogDescription>Carga un archivo CSV o Excel con las columnas de la plantilla. Los registros que ya existen se omiten.</DialogDescription>
        </DialogHeader>
        <ImportStepIndicator layout="bar" steps={STEPS} current={step} className="mt-1 shrink-0" />
        <div className="mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain">
          {step === 'template' ? (
            <div className="space-y-3">
              <p className="text-sm text-[hsl(var(--muted-foreground))]">Descarga la plantilla, llénala sin cambiar los encabezados y súbela en el siguiente paso.</p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={() => download('xlsx')}><Download className="mr-1.5 h-3.5 w-3.5" />Plantilla Excel</Button>
                <Button type="button" variant="outline" onClick={() => download('csv')}><Download className="mr-1.5 h-3.5 w-3.5" />Plantilla CSV</Button>
                <Button type="button" variant="ghost" onClick={() => setStep('file')}>Ya tengo mi archivo</Button>
              </div>
            </div>
          ) : null}
          {step === 'file' ? (
            <div className="flex flex-col items-start gap-2 rounded-xl border border-dashed border-[hsl(var(--border))] p-6">
              <input ref={fileRef} type="file" accept=".csv,.xlsx" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
              <Button type="button" onClick={() => fileRef.current?.click()} disabled={busy}>
                <Upload className="mr-1.5 h-3.5 w-3.5" />{busy ? 'Leyendo archivo...' : 'Elegir archivo'}
              </Button>
              <p className="text-xs text-[hsl(var(--muted-foreground))]">CSV o Excel (.xlsx), hasta 2,000 filas y 5 MB.</p>
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
          <Button type="button" variant="ghost" onClick={() => close(false)}>Cancelar</Button>
          {step === 'preview' ? (
            <Button type="button" disabled={busy || creatable === 0} onClick={commit}>{busy ? 'Importando...' : `Importar ${creatable}`}</Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
