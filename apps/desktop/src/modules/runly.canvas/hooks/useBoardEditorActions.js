import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { defaultBox, defaultStyle, toolToType } from '../lib/objectFactory.js'
import { fitSize, isImage, isPdf, openPdf, readImageSize, renderPdfPage } from '../lib/media.js'
import { screenToWorld } from '../engine/viewport.js'
import { useCreateHotspot, useCreatePage, useObjectBatch, useUpdateLayer, useUploadFile } from './useCanvasData.js'

const DRAWABLE = new Set(['vector', 'data'])
let clientSequence = 0
const clientId = () => `local-${Date.now()}-${(clientSequence += 1)}`

function mergePatch(object, patch) {
  const data = {}
  for (const key of ['transform', 'geometry', 'style', 'properties']) {
    if (patch[key]) data[key] = { ...(object[key] ?? {}), ...patch[key] }
  }
  return data
}

// All editor mutations live here so BoardEditor stays a layout component.
export function useBoardEditorActions({ boardId, pageId, rows, layers, layerId, setLayerId, setSelectedId, setTool, viewport, size, openDialog }) {
  const batch = useObjectBatch(boardId, pageId), hotspot = useCreateHotspot(boardId, pageId)
  const createPage = useCreatePage(boardId), updateLayer = useUpdateLayer(boardId), upload = useUploadFile()
  const [inserting, setInserting] = useState(false)
  const [pdf, setPdf] = useState(null)
  const fileInputRef = useRef(null)

  const fail = (error) => toast.error(error?.message ?? 'No se pudo guardar el cambio.')
  const layerById = (id) => layers.find((layer) => layer.id === id)
  const current = (id) => rows.find((row) => row.id === id)
  const topPosition = (targetLayerId) => Math.max(0, ...rows.filter((row) => row.layerId === targetLayerId).map((row) => row.position ?? 0)) + 1

  function drawableLayer() {
    const active = layerById(layerId)
    if (active && DRAWABLE.has(active.type) && !active.locked) return active
    return layers.find((layer) => layer.type === 'vector' && !layer.locked) ?? layers.find((layer) => DRAWABLE.has(layer.type) && !layer.locked)
  }
  function layerForTool(tool) {
    if (tool === 'hotspot') return layers.find((layer) => layer.type === 'hotspot')
    return drawableLayer()
  }

  // Picking a tool moves to a layer that can hold what it draws.
  function chooseTool(tool) {
    setTool(tool)
    if (tool === 'select' || tool === 'pan') return
    const target = layerForTool(tool)
    if (target && target.id !== layerId) setLayerId(target.id)
  }

  async function create({ tool, box, point }) {
    const layer = layerForTool(tool)
    if (!layer) return toast.error(tool === 'hotspot' ? 'Esta página no tiene capa de hotspots.' : 'No hay una capa de dibujo disponible.')
    if (layer.locked) return toast.error(`La capa «${layer.name}» está bloqueada.`)
    if (layer.id !== layerId) setLayerId(layer.id)
    const { type, properties } = toolToType(tool)
    const geometryBox = box ?? defaultBox(tool, point)
    const id = clientId()
    const data = {
      pageId, layerId: layer.id, type, position: topPosition(layer.id),
      transform: { x: geometryBox.x, y: geometryBox.y, rotation: 0, scaleX: 1, scaleY: 1 },
      geometry: { width: geometryBox.width, height: geometryBox.height },
      style: defaultStyle(tool), properties: tool === 'text' ? { text: 'Texto' } : properties,
    }
    setSelectedId(id); setTool('select')
    try {
      const response = await batch.mutateAsync([{ op: 'create', clientId: id, data }])
      const created = (response?.data ?? response)?.[0]?.object
      if (!created) return
      setSelectedId(created.id)
      if (type === 'hotspot') {
        openDialog({ kind: 'hotspot', id: created.id })
        await hotspot.mutateAsync({ objectId: created.id, title: 'Nuevo hotspot' })
      } else if (type === 'text') openDialog({ kind: 'text', id: created.id })
    } catch (error) { setSelectedId(null); fail(error) }
  }

  function update(object, data) {
    const row = current(object.id)
    if (!row || row.pending) return
    batch.mutate([{ op: 'update', id: row.id, expectedRevision: row.revision, data }], { onError: fail })
  }

  const commit = (next) => update(next, { transform: next.transform, geometry: next.geometry })
  const patch = (object, change) => { const row = current(object.id); if (row) update(row, mergePatch(row, change)) }

  function remove(object) {
    const row = current(object?.id)
    if (!row) return Promise.resolve()
    setSelectedId(null)
    return batch.mutateAsync([{ op: 'delete', id: row.id, expectedRevision: row.revision }]).catch(fail)
  }

  async function duplicate(object) {
    const row = current(object.id)
    if (!row) return
    const id = clientId()
    const data = {
      pageId, layerId: row.layerId, type: row.type === 'hotspot' ? 'hotspot' : row.type, position: topPosition(row.layerId),
      transform: { ...row.transform, x: (row.transform?.x ?? 0) + 24, y: (row.transform?.y ?? 0) + 24 },
      geometry: row.geometry, style: row.style, properties: row.properties,
    }
    setSelectedId(id)
    try {
      const response = await batch.mutateAsync([{ op: 'create', clientId: id, data }])
      const created = (response?.data ?? response)?.[0]?.object
      if (!created) return
      setSelectedId(created.id)
      if (row.type === 'hotspot') await hotspot.mutateAsync({ objectId: created.id, title: `${row.hotspot?.title ?? 'Hotspot'} (copia)`, description: row.hotspot?.description, color: row.hotspot?.color, status: row.hotspot?.status })
    } catch (error) { fail(error) }
  }

  function arrange(object, where) {
    const row = current(object.id)
    if (!row) return
    const siblings = rows.filter((item) => item.layerId === row.layerId).map((item) => item.position ?? 0)
    update(row, { position: where === 'front' ? Math.max(0, ...siblings) + 1 : Math.min(0, ...siblings) - 1 })
  }

  function nudge(object, dx, dy) {
    const row = current(object?.id)
    if (!row || layerById(row.layerId)?.locked) return
    update(row, { transform: { ...row.transform, x: (row.transform?.x ?? 0) + dx, y: (row.transform?.y ?? 0) + dy } })
  }

  async function toggleLayer(layer, data) {
    try { await updateLayer.mutateAsync({ pageId, layerId: layer.id, data }) } catch (error) { fail(error) }
  }

  async function addPage(count) {
    try { return await createPage.mutateAsync({ name: `Página ${count + 1}` }) } catch (error) { fail(error); return null }
  }

  // ---- Images and PDFs --------------------------------------------------
  function viewportCenter() { return screenToWorld({ x: size.width / 2, y: size.height / 2 }, viewport) }
  const maxInsertSide = () => Math.max(200, Math.min(900, (Math.min(size.width, size.height) * 0.7) / viewport.zoom))

  async function placeImages(items) {
    const layer = drawableLayer()
    if (!layer) throw new Error('No hay una capa de dibujo disponible.')
    const center = viewportCenter(), gap = 40
    const totalWidth = items.reduce((sum, item) => sum + item.size.width, 0) + gap * (items.length - 1)
    let x = center.x - totalWidth / 2
    const back = Math.min(0, ...rows.filter((row) => row.layerId === layer.id).map((row) => row.position ?? 0)) - 1
    const operations = items.map((item, index) => {
      const op = {
        op: 'create', clientId: clientId(),
        data: {
          pageId, layerId: layer.id, type: 'image', position: back - index,
          transform: { x, y: center.y - item.size.height / 2, rotation: 0, scaleX: 1, scaleY: 1 },
          geometry: item.size, style: {}, properties: item.properties,
        },
      }
      x += item.size.width + gap
      return op
    })
    const response = await batch.mutateAsync(operations)
    const created = (response?.data ?? response)?.[0]?.object
    if (created) setSelectedId(created.id)
  }

  async function insertImage(file) {
    const [asset, natural] = await Promise.all([upload.mutateAsync(file), readImageSize(file)])
    await placeImages([{ size: fitSize(natural.width, natural.height, maxInsertSide()), properties: { fileId: asset.id, name: file.name, naturalWidth: natural.width, naturalHeight: natural.height } }])
  }

  async function insertPdfPages(pages, target = pdf) {
    if (!target) return
    setInserting(true)
    try {
      const source = await upload.mutateAsync(target.file)
      const items = []
      for (const number of pages) {
        const page = await renderPdfPage(target.doc, number)
        const png = new File([page.blob], `${target.file.name.replace(/\.pdf$/i, '')}-p${number}.png`, { type: 'image/png' })
        const asset = await upload.mutateAsync(png)
        items.push({
          size: fitSize(page.pointWidth, page.pointHeight, maxInsertSide()),
          properties: { fileId: asset.id, sourceFileId: source.id, name: target.file.name, page: number, naturalWidth: page.width, naturalHeight: page.height },
        })
      }
      await placeImages(items)
      toast.success(pages.length === 1 ? 'Página insertada' : `${pages.length} páginas insertadas`)
      target.doc.destroy?.(); setPdf(null)
    } catch (error) { fail(error) } finally { setInserting(false) }
  }

  async function handleFile(file) {
    if (!file) return
    if (!isImage(file) && !isPdf(file)) return toast.error('Formato no soportado. Usa una imagen (PNG, JPG, WebP, SVG) o un PDF.')
    setInserting(true)
    try {
      if (isImage(file)) { await insertImage(file); toast.success('Imagen insertada'); return }
      const doc = await openPdf(file)
      if (doc.numPages === 1) await insertPdfPages([1], { file, doc })
      else setPdf({ file, doc })
    } catch (error) { fail(error) } finally { setInserting(false) }
  }

  return {
    batch, hotspot, createPage, updateLayer, inserting, pdf, fileInputRef,
    chooseTool, create, commit, patch, remove, duplicate, arrange, nudge, toggleLayer, addPage,
    openFilePicker: () => fileInputRef.current?.click(),
    handleFile, insertPdfPages,
    cancelPdf: () => { pdf?.doc.destroy?.(); setPdf(null) },
    saving: batch.isPending || hotspot.isPending || updateLayer.isPending || inserting,
  }
}
