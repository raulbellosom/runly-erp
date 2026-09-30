import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
  ErrorState, ImportStepIndicator, cn,
} from '@runly/ui'
import { Download, FileSpreadsheet, ListChecks, Loader2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../../auth/AuthProvider'
import { useActiveCompany } from '../../../company/ActiveCompanyProvider'
import { getApiUrl } from '../../../lib/runtimeConfig.js'
import { intakeRequest } from '../lib/intake.js'
import { ImportMappingStep } from './item-import/ImportMappingStep.jsx'
import { ImportPreviewStep } from './item-import/ImportPreviewStep.jsx'

const STEPS = [
  { key: 'file', label: 'Archivo', icon: Upload },
  { key: 'mapping', label: 'Relacionar columnas', icon: ListChecks },
  { key: 'preview', label: 'Revisar e importar', icon: FileSpreadsheet },
]

// Spreadsheet import for inventory items without AI: the user relates each
// file column to an item field, reviews the result, then imports. Photos come
// from pictures placed over the rows (XLSX) or a column of image links.
export function InventoryItemImportDialog({ open, onOpenChange, onImported }) {
  const { session } = useAuth()
  const { activeCompanyId } = useActiveCompany()
  const qc = useQueryClient()
  const token = session?.access_token
  const fileRef = useRef(null)
  const [step, setStep] = useState('file')
  const [file, setFile] = useState(null)
  const [parsed, setParsed] = useState(null)
  const [mapping, setMapping] = useState({})
  const [preview, setPreview] = useState(null)
  const [createMissing, setCreateMissing] = useState(true)
  const [statusMap, setStatusMap] = useState({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)

  const call = (path, body) => intakeRequest({ apiBaseUrl: getApiUrl(), token, companyId: activeCompanyId, path: `/inventory/item-import${path}`, body })

  function close(next) {
    if (!next) {
      setStep('file'); setFile(null); setParsed(null); setMapping({}); setPreview(null)
      setError(''); setCreateMissing(true); setStatusMap({})
    }
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

  async function handleFile(next) {
    if (fileRef.current) fileRef.current.value = ''
    if (!next) return
    setBusy(true); setError('')
    try {
      const form = new FormData()
      form.append('file', next)
      const data = await call('/parse', form)
      if (!data.rows.length) throw new Error('El archivo no tiene filas con datos.')
      setFile(next)
      setParsed({ ...data, fileName: next.name })
      setMapping(data.mapping ?? {})
      setStep('mapping')
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  async function runPreview(options = {}) {
    const missing = options.createMissing ?? createMissing
    const statuses = options.statusMap ?? statusMap
    setBusy(true); setError('')
    try {
      setPreview(await call('/preview', { rows: parsed.rows, rowNumbers: parsed.rowNumbers, mapping, createMissing: missing, statusMap: statuses }))
      setStep('preview')
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  async function commit() {
    setBusy(true); setError('')
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('options', JSON.stringify({ mapping, createMissing, statusMap }))
      const result = await call('/commit', form)
      const parts = [`${result.created} activos creados`]
      if (result.photos) parts.push(`${result.photos} fotos adjuntas`)
      if (result.skipped) parts.push(`${result.skipped} omitidos`)
      if (result.failed) parts.push(`${result.failed} con error`)
      toast.success(`${parts.join(', ')}.`)
      if (result.photoFailures?.length) toast.warning(`${result.photoFailures.length} fotos no se pudieron adjuntar. ${result.photoFailures[0].message}`)
      await qc.invalidateQueries({ queryKey: ['inventory'] })
      onImported?.(result)
      close(false)
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  const creatable = preview?.counts.new ?? 0

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent scrollable size="2xl">
        <DialogHeader>
          <DialogTitle>Importar activos</DialogTitle>
          <DialogDescription>Carga un CSV o Excel con tus activos y relaciona cada columna con un campo del inventario.</DialogDescription>
        </DialogHeader>
        <ImportStepIndicator layout="bar" steps={STEPS} current={step} className="mt-1 shrink-0" />
        <div className="mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-0.5">
          {step === 'file' ? (
            <div className="space-y-3">
              <input ref={fileRef} type="file" accept=".csv,.xlsx" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
              <button
                type="button"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files?.[0]) }}
                className={cn(
                  'flex w-full flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors',
                  dragging ? 'border-(--brand-primary) bg-(--brand-soft)' : 'border-[hsl(var(--border))] hover:border-(--brand-primary)/60 hover:bg-[hsl(var(--muted))]/30',
                )}
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-(--brand-soft) text-(--brand-primary)">
                  {busy ? <Loader2 className="h-6 w-6 animate-spin" /> : <FileSpreadsheet className="h-6 w-6" />}
                </span>
                <span className="space-y-1">
                  <span className="block text-sm font-semibold text-[hsl(var(--foreground))]">
                    {busy ? 'Leyendo archivo...' : 'Arrastra tu archivo aquí o haz clic para elegirlo'}
                  </span>
                  <span className="block text-xs text-[hsl(var(--muted-foreground))]">CSV o Excel (.xlsx) · hasta 2,000 filas · 25 MB</span>
                </span>
              </button>
              <div className="space-y-2 rounded-xl bg-[hsl(var(--muted))]/40 px-4 py-3 text-xs text-[hsl(var(--muted-foreground))]">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p>La primera fila deben ser los encabezados, con cualquier nombre. En el siguiente paso los relacionas con los campos, incluidos tus campos personalizados.</p>
                  <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={downloadTemplate}>
                    <Download className="mr-1.5 h-3.5 w-3.5" />Plantilla Excel
                  </Button>
                </div>
                <p><span className="font-medium text-[hsl(var(--foreground))]">Fotos:</span> en Excel, inserta la imagen sobre la fila del activo (Insertar › Imágenes); o agrega una columna con enlaces directos a las imágenes, separados por coma.</p>
              </div>
            </div>
          ) : null}

          {step === 'mapping' && parsed ? <ImportMappingStep parsed={parsed} mapping={mapping} onMappingChange={setMapping} /> : null}

          {step === 'preview' && preview ? (
            <ImportPreviewStep
              preview={preview}
              imageCounts={parsed.imageCounts}
              createMissing={createMissing}
              onCreateMissingChange={(next) => { setCreateMissing(next); runPreview({ createMissing: next }) }}
              statusMap={statusMap}
              statuses={parsed.statuses}
              onStatusMapChange={(next) => { setStatusMap(next); runPreview({ statusMap: next }) }}
              busy={busy}
            />
          ) : null}

          {error ? <ErrorState title="No se pudo procesar el archivo" description={error} /> : null}
        </div>
        <DialogFooter className="shrink-0">
          {step === 'mapping' ? <Button type="button" variant="ghost" onClick={() => setStep('file')}>Cambiar archivo</Button> : null}
          {step === 'preview' ? <Button type="button" variant="ghost" disabled={busy} onClick={() => setStep('mapping')}>Volver al mapeo</Button> : null}
          <Button type="button" variant="ghost" onClick={() => close(false)}>Cancelar</Button>
          {step === 'mapping' ? (
            <Button type="button" disabled={busy || !Object.values(mapping).some(Boolean)} onClick={() => runPreview()}>{busy ? 'Analizando...' : 'Revisar'}</Button>
          ) : null}
          {step === 'preview' ? (
            <Button type="button" disabled={busy || creatable === 0} onClick={commit}>
              {busy ? 'Importando...' : creatable === 0 ? 'Nada que importar' : `Importar ${creatable} ${creatable === 1 ? 'activo' : 'activos'}`}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
