import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Sparkles, Barcode, Camera, Trash2, Plus, Check, ZoomIn, Loader2, CheckCircle2, AlertCircle, Clock3 } from 'lucide-react'
import { RunlyForm, Button, AIUploadDropzone, AIFlowSteps, Input, Textarea, Checkbox, Card, Badge,
  Alert, AlertTitle, AlertDescription, ImageSourceSheet, ImageViewer, AttachmentsPanel, ErrorState, ConfirmDialog, useCoarsePointer, cn } from '@runly/ui'
import { InventoryCaptureTable } from './InventoryCaptureTable.jsx'
import { INVENTORY_ITEM_FORM } from '../blueprints/inventory-item-form.blueprint.js'
import { useInventoryFormBlueprint } from '../hooks/useInventoryFormBlueprint.js'
import { useInventoryBrands, useInventoryCategories } from '../hooks/useInventoryCatalogs.js'
import { collectSuggestions, confirmationKey, identifiersFor, intakeRequest } from '../lib/intake.js'

const LABELS = { name: 'Nombre', itemType: 'Tipo', brandName: 'Marca', categoryName: 'Categoría', model: 'Modelo', partNumber: 'Número de parte', serialNumber: 'Número de serie', productCode: 'Código de producto', description: 'Descripción visible' }
const ATTACHMENTS = INVENTORY_ITEM_FORM.schema.sections.find(s => s.type === 'attachments').attachments
const INITIAL_UNIT = { id: 'unit-0', serialNumber: '', assetTag: '', photoIds: [] }
const FLOW_STEPS = [
  { key: 'capture', label: 'Modo de captura', description: 'Un equipo o varios' },
  { key: 'read', label: 'Lectura con IA', description: 'Sube fotos y analiza' },
  { key: 'review', label: 'Revisión', description: 'Confirma datos y series' },
  { key: 'done', label: 'Equipos creados', description: 'Fotos asociadas' },
]
const PHOTO_STATE_META = {
  reading: { icon: Loader2, label: 'Leyendo…', spin: true, style: { background: 'var(--brand-primary)', color: 'var(--brand-primary-foreground)' } },
  error: { icon: AlertCircle, label: 'Error', className: 'badge-destructive' },
  done: { icon: CheckCircle2, label: 'Listo', className: 'badge-success' },
  pending: { icon: Clock3, label: 'Pendiente', className: 'border border-[hsl(var(--border))] bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]' },
}

function SavedPhotos({ item, files, apiBaseUrl, token, companyId, onStatus }) {
  const started = useRef(false)
  const ready = useCallback(controller => {
    if (!controller) return
    onStatus(item.id, controller.loading || controller.pendingItems.length > 0 || controller.associatedItems.length < files.length)
    if (started.current) return
    started.current = true
    if (files.length) void controller.queueFiles(files)
  }, [files, item.id, onStatus])
  return <Card className="space-y-3 p-4">
    <p className="font-medium">{item.assetTag} · {item.serialNumber || 'Sin serie'}</p>
    <AttachmentsPanel config={ATTACHMENTS} recordId={item.id} apiBaseUrl={apiBaseUrl} token={token} companyId={companyId} context="detail" onControllerReady={ready} />
  </Card>
}

export function InventorySmartForm({ token, companyId, apiBaseUrl, onCancel }) {
  const formBlueprint = useInventoryFormBlueprint()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const coarse = useCoarsePointer()
  const [batch, setBatch] = useState(false)
  const [units, setUnits] = useState([INITIAL_UNIT])
  const [photos, setPhotos] = useState([])
  const [scan, setScan] = useState('')
  const [paste, setPaste] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [analysisSummary, setAnalysisSummary] = useState('')
  const [error, setError] = useState('')
  const [issues, setIssues] = useState([])
  const [camera, setCamera] = useState(false)
  const [viewer, setViewer] = useState(null)
  const [saved, setSaved] = useState(null)
  const [discard, setDiscard] = useState(false)
  const [pendingSave, setPendingSave] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [photoStatus, setPhotoStatus] = useState({})
  const [leaveSaved, setLeaveSaved] = useState(false)
  const sequence = useRef(0)
  const urls = useRef(new Set())
  const abort = useRef(null)
  const mounted = useRef(true)
  const requestKey = useRef(null)
  const requestSnapshot = useRef(null)
  const { data: brands } = useInventoryBrands()
  const { data: categories } = useInventoryCategories()
  const updatePhotoStatus = useCallback((id, pending) => setPhotoStatus(current => current[id] === pending ? current : { ...current, [id]: pending }), [])
  const photosPending = Boolean(saved && saved.some((item, index) => units[index].photoIds.length && photoStatus[item.id] !== false))
  const flowActiveIndex = saved ? 3 : (!analyzing && photos.some(p => p.result)) ? 2 : photos.length ? 1 : 0
  useEffect(() => {
    if (!(saved ? photosPending : photos.length || units.some(unit => unit.serialNumber || unit.assetTag))) return
    const preventLoss = event => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', preventLoss)
    return () => window.removeEventListener('beforeunload', preventLoss)
  }, [photos.length, photosPending, saved, units])
  useEffect(() => {
    mounted.current = true
    const allocated = urls.current
    return () => { mounted.current = false; abort.current?.abort(); for (const url of allocated) URL.revokeObjectURL(url) }
  }, [])

  const suggestions = useMemo(() => collectSuggestions(photos), [photos])
  const blueprint = useMemo(() => ({ ...formBlueprint, schema: { ...formBlueprint.schema,
    submitLabel: `Crear ${units.length} ${units.length === 1 ? 'equipo' : 'equipos'}`,
    sections: formBlueprint.schema.sections.filter(s => s.type !== 'attachments').map(s => ({ ...s,
      fields: s.fields?.filter(f => !['assetTag', 'serialNumber'].includes(f.field)) })),
  } }), [units.length, formBlueprint])

  const updateUnit = (id, patch) => { setUnits(current => current.map(u => u.id === id ? { ...u, ...patch, confirmation: null, duplicateAcknowledged: false } : u)); setIssues([]) }
  function addSerials(entries) {
    const extra = new Set(entries.filter(entry => entry.value.trim() && !units.some(unit => unit.serialNumber === entry.value)).map(entry => entry.value))
    if (units.filter(unit => unit.serialNumber || unit.assetTag || unit.photoIds.length).length + extra.size > 200) {
      toast.error('El lote admite hasta 200 equipos. Guarda esta captura antes de agregar más.'); return false
    }
    const incoming = entries.filter(entry => entry.value.trim()).map(entry => ({
      id: `unit-${++sequence.current}`, serialNumber: entry.value, assetTag: '', photoIds: entry.photoIds ?? [],
    }))
    if (entries.some(entry => units.some(unit => unit.serialNumber === entry.value) && !entry.photoIds?.length)) toast.warning('Esta serie ya está en la captura.')
    setUnits(current => {
      let next = current.filter(unit => unit.serialNumber || unit.assetTag || unit.photoIds.length)
      for (const unit of incoming) {
        const existing = next.find(row => row.serialNumber === unit.serialNumber)
        if (existing) next = next.map(row => row.id === existing.id
          ? { ...row, photoIds: [...new Set([...row.photoIds, ...unit.photoIds])], confirmation: null } : row)
        else if (next.length < 200) next = [...next, unit]
      }
      return next.length ? next : current
    })
    setScan(''); setIssues([])
    return true
  }
  function addSerial(value, photoIds = []) { addSerials([{ value, photoIds }]) }
  function addBlank() {
    const unit = { ...INITIAL_UNIT, id: `unit-${++sequence.current}` }
    setUnits(current => current.length < 200 ? [...current, unit] : current)
  }
  function removePhoto(photo) {
    URL.revokeObjectURL(photo.url); urls.current.delete(photo.url)
    setPhotos(current => current.filter(p => p.id !== photo.id))
    setUnits(current => current.map(unit => ({ ...unit, photoIds: unit.photoIds.filter(id => id !== photo.id), confirmation: null })))
  }
  async function addPhotos(files, values, patchValues) {
    if (files.length > 10 || photos.length + files.length > (batch ? 50 : 20)) throw new Error('Máximo 10 fotos por tanda, 20 por equipo y 50 por lote.')
    if (files.some(f => f.size > 10 * 1024 * 1024 || !/^image\/(jpeg|png|webp|heic|heif)$/.test(f.type))) throw new Error('Usa JPEG, PNG, WebP o HEIC de hasta 10 MB.')
    const incoming = files.map(file => {
      const url = URL.createObjectURL(file); urls.current.add(url)
      return { id: `photo-${++sequence.current}`, file, url }
    })
    setPhotos(current => [...current, ...incoming])
    if (!batch) setUnits(current => [{ ...(current[0] ?? INITIAL_UNIT), photoIds: [...(current[0]?.photoIds ?? []), ...incoming.map(p => p.id)] }])
    await analyze(values, patchValues, [...photos, ...incoming], incoming)
  }
  async function analyze(values, patchValues, allPhotos = photos, selectedPhotos = null) {
    const pending = (selectedPhotos ?? allPhotos.filter(p => !p.result || p.result.error)).slice(0, 10)
    if (!pending.length || analyzing) return
    setError(''); setAnalysisSummary(''); setAnalyzing(true)
    setPhotos(current => current.map(photo => pending.some(p => p.id === photo.id) ? { ...photo, reading: true } : photo))
    abort.current = new AbortController()
    try {
      const form = new FormData()
      pending.forEach(p => form.append('files', p.file))
      const result = await intakeRequest({ apiBaseUrl, token, companyId, path: '/inventory/ai/recognize', body: form, signal: abort.current.signal })
      if (!mounted.current) return
      if (!Array.isArray(result?.images)) throw new Error('El servidor no devolvió resultados de lectura. Reintenta las fotos.')
      const analyzed = pending.map((p, i) => ({ ...p, reading: false, result: result.images.find(row => row.index === i) ?? { error: 'No se recibió la lectura de esta foto.', observations: [] } }))
      setPhotos(current => current.map(p => analyzed.find(a => a.id === p.id) ?? p))
      const combined = allPhotos.map(p => analyzed.find(a => a.id === p.id) ?? p)
      const proposed = collectSuggestions(combined)
      const patch = {}
      for (const field of ['name', 'itemType', 'model', 'partNumber']) {
        const options = proposed[field] ?? []
        if (!values[field] && options.length === 1 && !options[0].uncertain) patch[field] = options[0].value
      }
      for (const [field, catalog, target] of [['brandName', brands?.data, 'brandId'], ['categoryName', categories?.data, 'categoryId']]) {
        const options = proposed[field] ?? []
        const match = options.length === 1 && !options[0].uncertain && catalog?.find(item => item.name.trim().toLocaleLowerCase() === options[0].value.trim().toLocaleLowerCase())
        if (!values[target] && match) patch[target] = match.id
      }
      if (Object.keys(patch).length) patchValues(patch)
      if (batch) addSerials(analyzed.flatMap(photo => (photo.result?.observations ?? [])
        .filter(o => o.field === 'serialNumber' && o.status === 'observed' && o.value)
        .map(o => ({ value: o.value, photoIds: [photo.id] }))))
      else if (proposed.serialNumber?.length === 1 && !proposed.serialNumber[0].uncertain) {
        const suggestion = proposed.serialNumber[0]
        setUnits(current => current.map(unit => !unit.serialNumber ? { ...unit, serialNumber: suggestion.value, confirmation: null } : unit))
      }
      const failures = analyzed.filter(photo => photo.result.error).length
      const fields = Object.keys(patch).map(field => ({ brandId: 'Marca', categoryId: 'Categoría', ...LABELS })[field]).join(', ')
      const summary = `${analyzed.length - failures} de ${analyzed.length} fotos leídas.${fields ? ` Campos completados: ${fields}.` : ' No se completaron campos comunes automáticamente.'} Revisa el texto, las propuestas y la serie de cada equipo.`
      setAnalysisSummary(summary)
      if (failures === analyzed.length) toast.error('No se pudieron leer las fotos. Consulta el motivo debajo de cada imagen.')
      else if (failures) toast.warning('Lectura parcial. Se conservaron los resultados de las fotos leídas.')
      else toast.success('Lectura terminada. Revisa los datos antes de crear el equipo.')
    } catch (err) {
      if (mounted.current && err.name !== 'AbortError') {
        setError(err.message)
        setPhotos(current => current.map(photo => pending.some(p => p.id === photo.id) ? { ...photo, result: { ...photo.result, error: err.message } } : photo))
      }
    } finally { if (mounted.current) { setAnalyzing(false); setPhotos(current => current.map(photo => photo.reading ? { ...photo, reading: false } : photo)) } }
  }

  async function submit({ payload }) {
    if (analyzing) throw new Error('Espera a que termine el análisis.')
    if (!units.length) throw new Error('Agrega al menos un equipo.')
    if (photos.some(photo => !units.some(unit => unit.photoIds.includes(photo.id)))) throw new Error('Asigna cada foto a un equipo o quítala de la captura antes de guardar.')
    if (units.some(unit => unit.photoIds.length > 20)) throw new Error('Cada equipo admite hasta 20 fotografías.')
    const body = {
      common: payload,
      proofs: photos.flatMap(p => p.result?.proof ? [p.result.proof] : []),
      units: units.map(unit => ({ ...identifiersFor(unit, payload),
        confirmedIdentifiers: unit.confirmation === confirmationKey(unit, payload) ? identifiersFor(unit, payload) : undefined,
        duplicateAcknowledged: unit.duplicateAcknowledged ?? false,
        sourceImageIds: unit.photoIds.flatMap(id => { const p = photos.find(photo => photo.id === id); return p?.result?.proof ? [p.result.imageId] : [] }),
      })),
    }
    // Once a request could have reached the server, retries use the same bytes/key.
    const snapshot = JSON.stringify(body)
    if (requestSnapshot.current && requestSnapshot.current !== snapshot) throw new Error('Hay un guardado pendiente de confirmar. Reintenta con los mismos datos antes de modificar el lote.')
    if (!requestKey.current) requestKey.current = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('')
    try {
      if (!requestSnapshot.current) {
        const checked = await intakeRequest({ apiBaseUrl, token, companyId, path: '/inventory/items/validate-batch', body: { ...body, key: requestKey.current } })
        setIssues(checked.issues)
        if (!checked.valid) throw new Error('Revisa las advertencias de la captura antes de crear los equipos.')
      }
      requestSnapshot.current = snapshot
      const result = await intakeRequest({ apiBaseUrl, token, companyId, path: '/inventory/items/bulk', body: { ...body, key: requestKey.current } })
      if (mounted.current) { setSaved(result.items); setPendingSave(false) }
      void queryClient.invalidateQueries({ queryKey: ['inventory'] })
      return { data: result }
    } catch (err) {
      if (err.issues?.length) setIssues(err.issues)
      if (err.status >= 400 && err.status < 500) requestSnapshot.current = null
      else if (requestSnapshot.current && mounted.current) setPendingSave(true)
      throw err
    }
  }

  async function retrySave() {
    if (retrying || !requestSnapshot.current) return
    setRetrying(true)
    try { await submit({ payload: JSON.parse(requestSnapshot.current).common }) }
    catch (err) { toast.error(err.message); if (!requestSnapshot.current) setPendingSave(false) }
    finally { setRetrying(false) }
  }

  function renderCapture({ values, patchValues, disabled }) {
    const busy = disabled || analyzing
    function applySuggestion(field, suggestion) {
      if (field === 'serialNumber') {
        if (batch) addSerial(suggestion.value, suggestion.imageIds)
        else setUnits(current => [{ ...(current[0] ?? INITIAL_UNIT), serialNumber: suggestion.value, photoIds: [...new Set([...(current[0]?.photoIds ?? []), ...suggestion.imageIds])], confirmation: null }])
      } else if (field === 'brandName' || field === 'categoryName') {
        const options = field === 'brandName' ? brands?.data : categories?.data
        const match = options?.find(o => o.name.toLocaleLowerCase() === suggestion.value.toLocaleLowerCase())
        if (match) patchValues({ [field === 'brandName' ? 'brandId' : 'categoryId']: match.id })
        else toast.info('Busca o crea este valor en el catálogo del formulario.')
      } else if (field === 'description' || field === 'productCode') {
        patchValues({ notes: [values.notes, `${LABELS[field]}: ${suggestion.value}`].filter(Boolean).join('\n') })
      } else patchValues({ [field]: suggestion.value })
    }
    return <Card className="space-y-5 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: 'var(--brand-primary)', color: 'var(--brand-primary-foreground)' }}><Sparkles className="h-5 w-5" /></div>
          <div><p className="font-semibold">Registrar con IA</p><p className="text-sm text-muted-foreground">Fotografía el equipo y sus etiquetas. Revisa todo antes de crear.</p></div>
        </div>
        <Badge>{units.length} {units.length === 1 ? 'equipo' : 'equipos'}</Badge>
      </div>
      <AIFlowSteps steps={FLOW_STEPS} activeIndex={flowActiveIndex} />
      <div className="space-y-3 border-t pt-4">
        <p className="text-xs font-medium text-muted-foreground">Paso 1 · Elige el modo de captura</p>
        <div className="flex flex-wrap gap-2"><Button type="button" variant={!batch ? 'default' : 'outline'} disabled={busy || units.length > 1} onClick={() => setBatch(false)}>Un equipo · varias fotos</Button><Button type="button" variant={batch ? 'default' : 'outline'} disabled={busy} onClick={() => setBatch(true)}>Varios equipos del mismo tipo</Button></div>
      </div>
      <div className="space-y-3">
        <p className="text-xs font-medium text-muted-foreground">Paso 2 · Sube fotos para que la IA las lea</p>
        <AIUploadDropzone multiple accept="image/jpeg,image/png,image/webp,image/heic,image/heif" disabled={busy} busy={analyzing}
          title="Suelta las fotos aquí para que la IA las lea" busyLabel="Leyendo las fotografías…"
          hint="La lectura comienza al soltar o elegir las fotos. Hasta 10 por tanda · 10 MB por foto." actionLabel="Elegir fotografías"
          onFiles={files => addPhotos(files, values, patchValues).catch(err => setError(err.message))} />
        {coarse && <Button type="button" variant="outline" disabled={busy} onClick={() => setCamera(true)}><Camera className="mr-2 h-4 w-4" />Tomar fotografía</Button>}
        {photos.length > 0 && <div className="flex flex-wrap gap-3">{photos.map((photo, index) => {
          const state = photo.reading ? 'reading' : photo.result?.error ? 'error' : photo.result ? 'done' : 'pending'
          const meta = PHOTO_STATE_META[state]
          return <div key={photo.id} className="w-28 space-y-1.5">
            <div className="group relative">
              <button type="button" aria-label={`Ampliar fotografía ${index + 1}`} className="block h-24 w-28 overflow-hidden rounded-xl border border-[hsl(var(--border))]" onClick={() => setViewer(photo)}>
                <img src={photo.url} alt={`Fotografía ${index + 1}`} className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105" />
              </button>
              <span className={cn('absolute left-1 top-1 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium', meta.className)} style={meta.style}>
                <meta.icon className={cn('h-3 w-3', meta.spin && 'animate-spin')} />{meta.label}
              </span>
              <span className="absolute bottom-1 right-1 rounded-full bg-black/60 px-1.5 text-[10px] font-medium text-white">{index + 1}</span>
            </div>
            <div className="flex items-center justify-between gap-1">
              <Button type="button" size="sm" variant="ghost" className="h-7 px-1.5 text-xs" onClick={() => setViewer(photo)}><ZoomIn className="h-3 w-3" />Ampliar</Button>
              <Button type="button" size="icon" variant="ghost" className="h-7 w-7 shrink-0" aria-label={`Quitar foto ${index + 1}`} disabled={busy} onClick={() => removePhoto(photo)}><Trash2 className="h-3 w-3" /></Button>
            </div>
          </div>
        })}</div>}
        <Button type="button" disabled={busy || !photos.some(p => !p.result || p.result.error)} onClick={() => analyze(values, patchValues)}><Sparkles className="mr-2 h-4 w-4" />{analyzing ? 'Analizando fotografías…' : 'Analizar hasta 10 fotos con IA'}</Button>
      </div>
      {error && <ErrorState title="No se pudo analizar" description={error} />}
      {analyzing && <p role="status" className="text-sm text-muted-foreground">Leyendo las etiquetas y buscando datos para el formulario…</p>}
      {analysisSummary && <Alert><AlertTitle>Resultado de la lectura</AlertTitle><AlertDescription>{analysisSummary}<p>Los datos dudosos, los valores distintos entre fotos y los campos que ya escribiste requieren revisión. Marca y categoría se completan si ya existen en tu catálogo.</p></AlertDescription></Alert>}
      {photos.map((photo, index) => photo.result && <section key={photo.id} aria-label={`Lectura de la foto ${index + 1}`} className="space-y-2 rounded-lg border p-3">
        <p className="break-words text-sm font-medium">Foto {index + 1} · {photo.file.name}</p>
        {photo.result.error && <ErrorState title="No se pudo leer esta foto" description={photo.result.error} />}
        {!photo.result.error && <><p className="text-xs text-muted-foreground">Texto extraído · comprueba los caracteres con la foto ampliada.</p><Textarea aria-label={`Texto extraído de la foto ${index + 1}`} readOnly rows={5} value={photo.result.rawText || (photo.result.observations ?? []).filter(o => o.value).map(o => `${LABELS[o.field]}: ${o.value}`).join('\n') || 'No se encontró texto legible.'} />
          {!photo.result.observations?.some(o => o.value) && <p className="text-sm text-muted-foreground">Hay una lectura de texto, pero no datos seguros para completar el formulario. Puedes copiarlos o escribirlos manualmente.</p>}
        </>}
        {(photo.result.warnings ?? []).map((warning, i) => <p key={`${photo.id}:${i}`} className="text-sm text-amber-700">{warning}</p>)}
      </section>)}
      {photos.some(p => p.result?.error) && <Alert><AlertDescription>Algunas fotos no pudieron analizarse. Puedes reintentar o escribir sus datos sin perder lo capturado.</AlertDescription></Alert>}
      {Object.keys(suggestions).length > 0 && <div className="space-y-3"><p className="text-sm font-medium">Propuestas observadas · pulsa un valor para aplicarlo</p>{Object.entries(suggestions).map(([field, options]) => <div key={field} className="space-y-1"><p className="text-xs text-muted-foreground">{LABELS[field]} {options.length > 1 && <span className="text-amber-600">· varios valores, revisa las fotos</span>}</p><div className="flex flex-wrap gap-2">{options.map(option => <Button type="button" key={option.value} variant="outline" size="sm" disabled={busy} onClick={() => applySuggestion(field, option)}>{option.value} · {option.uncertain ? 'Revisar' : 'Visible'} · Fotos {option.imageIds.map(id => photos.findIndex(p => p.id === id) + 1).join(', ')}</Button>)}</div></div>)}</div>}
      <ImageSourceSheet open={camera} onOpenChange={setCamera} onPickFile={file => addPhotos([file], values, patchValues).catch(err => setError(err.message))} />
      {batch && <div className="space-y-3 border-t pt-4"><label className="block text-sm font-medium" htmlFor="inventory-scanner">Lector o handheld · captura de series</label><div className="flex gap-2"><Input id="inventory-scanner" value={scan} disabled={busy} placeholder="Escanea y presiona Enter" onChange={e => setScan(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSerial(scan) } }} /><Button type="button" disabled={busy || !scan.trim()} onClick={() => addSerial(scan)}><Barcode className="h-4 w-4" /><span className="sr-only">Agregar serie</span></Button></div><Textarea aria-label="Pegar varias series" rows={3} value={paste} disabled={busy} placeholder="O pega una serie por línea desde Excel" onChange={e => setPaste(e.target.value)} /><Button type="button" variant="outline" disabled={busy || !paste.trim()} onClick={() => { if (addSerials(paste.split(/\r?\n/).map(value => ({ value })))) setPaste('') }}>Agregar series pegadas</Button></div>}
      <div className="space-y-3 border-t pt-4">
        <p className="text-xs font-medium text-muted-foreground">Paso 3 · Revisa cada equipo antes de crearlo</p>
        <InventoryCaptureTable units={units} values={values} busy={busy} photos={photos} updateUnit={updateUnit} setUnits={setUnits} />
      </div>
      {(batch || !units.length) && <Button type="button" variant="outline" disabled={busy || units.length >= 200} onClick={addBlank}><Plus className="mr-2 h-4 w-4" />Agregar equipo sin serie</Button>}
      {issues.length > 0 && <Alert><AlertTitle>Revisa la captura</AlertTitle><AlertDescription><div className="space-y-2">{issues.map((issue, i) => <div key={i}><p>Equipo {issue.index + 1}: {issue.message} {issue.item && <a className="underline" href={`/app/m/runly.inventory/inventory/${issue.item.id}`} target="_blank" rel="noreferrer">Ver {issue.item.assetTag}</a>}</p>{issue.item && issue.field === 'serialNumber' && <label className="flex items-center gap-2"><Checkbox checked={Boolean(units[issue.index]?.duplicateAcknowledged)} onCheckedChange={checked => setUnits(current => current.map((u, index) => index === issue.index ? { ...u, duplicateAcknowledged: Boolean(checked) } : u))} />Revisé la coincidencia y es otra unidad</label>}</div>)}</div></AlertDescription></Alert>}
      {photos.some(photo => !units.some(unit => unit.photoIds.includes(photo.id))) && <Alert><AlertDescription>Hay fotografías sin equipo asignado. Márcalas en la columna Fotos o quítalas antes de guardar.</AlertDescription></Alert>}
      <p className="text-xs text-muted-foreground">Hasta 200 equipos por lote. El número de parte corresponde al modelo y puede repetirse. Confirma que el código leído sea realmente la serie. Las fotos marcadas se asociarán a cada equipo.</p>
    </Card>
  }

  if (saved) return <div className="space-y-4">
    <AIFlowSteps steps={FLOW_STEPS} activeIndex={flowActiveIndex} />
    <Alert variant="success"><Check className="h-4 w-4" /><AlertTitle>{saved.length} {saved.length === 1 ? 'equipo creado' : 'equipos creados'}</AlertTitle><AlertDescription>{photosPending ? 'Las fotografías se están asociando. Si alguna falla, reintenta desde su panel sin crear el equipo de nuevo.' : 'El registro y sus fotografías están guardados.'}</AlertDescription></Alert>
    {saved.map((item, index) => units[index].photoIds.length > 0 && <SavedPhotos key={item.id} item={item} files={photos.filter(p => units[index].photoIds.includes(p.id)).map(p => p.file)} apiBaseUrl={apiBaseUrl} token={token} companyId={companyId} onStatus={updatePhotoStatus} />)}
    <Button onClick={() => photosPending ? setLeaveSaved(true) : navigate('/app/m/runly.inventory/inventory')}>Volver al inventario</Button>
    <ConfirmDialog open={leaveSaved} onOpenChange={setLeaveSaved} title="Hay fotografías pendientes" description="Los equipos ya están creados. Si sales, podrías tener que adjuntar nuevamente las fotografías pendientes desde sus detalles." confirmLabel="Salir" onConfirm={() => navigate('/app/m/runly.inventory/inventory')} />
  </div>
  return <>
    {pendingSave && <Alert><AlertTitle>Guardado pendiente de confirmar</AlertTitle><AlertDescription>Se perdió la respuesta del servidor. Reintenta para recuperar el mismo lote.</AlertDescription><Button type="button" disabled={retrying} onClick={retrySave}>{retrying ? 'Comprobando…' : 'Recuperar guardado'}</Button></Alert>}
    <fieldset disabled={pendingSave || analyzing} className="contents"><RunlyForm blueprint={blueprint} initialData={{ status: 'available' }} mode="create" token={token} companyId={companyId} apiBaseUrl={apiBaseUrl} renderTools={renderCapture} submitRequest={submit} onCancel={() => setDiscard(true)} /></fieldset>
    <ImageViewer key={viewer?.url ?? 'closed'} allowZoom open={Boolean(viewer)} src={viewer?.url} fileName={viewer?.file.name} onClose={() => setViewer(null)} />
    <ConfirmDialog open={discard} onOpenChange={setDiscard} title="Descartar captura" description="Se perderán las fotos y series que aún no guardaste." confirmLabel="Descartar" onConfirm={onCancel} />
  </>
}
