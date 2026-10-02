import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { buildObjectData, defaultBox } from '../lib/objectFactory.js'
import { buildOperations, createHistory, snapshot } from '../lib/history.js'
import { alignDeltas, distributeDeltas } from '../lib/arrange.js'
import { convertShape } from '../lib/shapeConvert.js'
import { fitSize, maxInsertSide } from '../lib/media.js'
import { placeObjects } from '../lib/libraryImport/normalize.js'
import { screenToWorld } from '../engine/viewport.js'
import { useCreateHotspot, useCreateLayer, useCreatePage, useObjectBatch, useUpdateLayer, useUploadFile } from './useCanvasData.js'
import { useMediaInsert } from './useMediaInsert.js'

const DRAWABLE = new Set(['vector', 'data'])
const LABELS = { move: 'Mover', resize: 'Redimensionar', rotate: 'Rotar' }
let clientSequence = 0
export const clientId = () => `local-${Date.now()}-${(clientSequence += 1)}`

function mergePatch(object, patch) {
  const data = {}
  for (const key of ['transform', 'geometry', 'style', 'properties']) {
    if (patch[key]) data[key] = { ...(object[key] ?? {}), ...patch[key] }
  }
  return data
}

// All editor mutations live here so BoardEditor stays a layout component.
// Every change is recorded in a per-page undo history (see lib/history.js).
export function useBoardEditorActions({ boardId, pageId, rows, layers, layerId, setLayerId, setSelectedIds, setTool, viewport, size, openDialog, calibratePage, hasCalibration }) {
  // Undo can fire later (e.g. from a toast action), so replays read the
  // latest rows instead of the ones captured when the callback was created.
  const rowsRef = useRef(rows)
  useLayoutEffect(() => { rowsRef.current = rows })
  // Session-only clipboard: plain snapshots, not row references, so copy
  // survives the source row being edited, deleted or even undone.
  const clipboardRef = useRef(null)
  const historiesRef = useRef(new Map())
  const [, setHistoryVersion] = useState(0)
  const historyFor = (id) => {
    if (!historiesRef.current.has(id)) historiesRef.current.set(id, createHistory())
    return historiesRef.current.get(id)
  }
  const history = historyFor(pageId)
  const bump = () => setHistoryVersion((value) => value + 1)
  const record = (changes, label, options) => { history.record(changes, label, options); bump() }

  const onCreated = useCallback((tempId, object) => {
    for (const item of historiesRef.current.values()) item.alias(tempId, object.id)
    setSelectedIds((ids) => ids.map((id) => id === tempId ? object.id : id))
  }, [setSelectedIds])
  const { mutation: batch, patchPending } = useObjectBatch(boardId, pageId, { onCreated })
  const hotspot = useCreateHotspot(boardId, pageId)
  const createPage = useCreatePage(boardId), updateLayer = useUpdateLayer(boardId), upload = useUploadFile(boardId), createLayer = useCreateLayer(boardId)

  const fail = (error) => toast.error(error?.message ?? 'No se pudo guardar el cambio.')
  const layerById = (id) => layers.find((layer) => layer.id === id)
  const current = (id) => rowsRef.current.find((row) => row.id === id)
  // An element can be excluded from editing by its own `properties.locked`
  // or by its layer's lock; the latter is the only one `setHidden`/`setLocked`
  // keep enforcing, since unlocking an element is how a user reverses the former.
  const onLockedLayer = (objects) => objects.map((object) => current(object?.id)).filter((row) => row && !layerById(row.layerId)?.locked)
  const editable = (objects) => onLockedLayer(objects).filter((row) => !row.properties?.locked)
  const topPosition = (targetLayerId) => Math.max(0, ...rows.filter((row) => row.layerId === targetLayerId).map((row) => row.position ?? 0)) + 1

  function drawableLayer() {
    const active = layerById(layerId)
    if (active && DRAWABLE.has(active.type) && !active.locked) return active
    return layers.find((layer) => layer.type === 'vector' && !layer.locked) ?? layers.find((layer) => DRAWABLE.has(layer.type) && !layer.locked)
  }
  const layerForTool = (tool) => tool === 'hotspot' ? layers.find((layer) => layer.type === 'hotspot') : drawableLayer()

  // Picking a tool moves to a layer that can hold what it draws.
  function chooseTool(tool) {
    setTool(tool)
    if (tool === 'select' || tool === 'pan') return
    const target = layerForTool(tool)
    if (target && target.id !== layerId) setLayerId(target.id)
  }

  // Sends updates for persisted rows and queues them for rows still being
  // created, recording one undo step for the whole set.
  function applyUpdates(entries, label, options) {
    if (!entries.length) return
    const operations = []
    for (const { row, data } of entries) {
      if (row.pending) patchPending(row.id, data)
      else operations.push({ op: 'update', id: row.id, expectedRevision: row.revision, data })
    }
    if (operations.length) batch.mutate(operations, { onError: fail })
    record(entries.map(({ row, data }) => ({ id: row.id, before: snapshot(row), after: { ...snapshot(row), ...data } })), label, options)
  }

  async function createRows(datas, label) {
    const operations = datas.map((data) => ({ op: 'create', clientId: clientId(), data }))
    setSelectedIds(operations.map((op) => op.clientId))
    // Recorded up front (with client ids, aliased to server ids on success)
    // so edits made while the create is in flight stack after it.
    record(operations.map((op) => ({ id: op.clientId, before: null, after: { ...op.data, id: op.clientId } })), label)
    const response = await batch.mutateAsync(operations)
    return (response?.data ?? response ?? []).map((result) => result.object).filter(Boolean)
  }

  async function create({ tool, box, point, connect }) {
    const layer = layerForTool(tool)
    if (!layer) return toast.error(tool === 'hotspot' ? 'Esta página no tiene capa de hotspots.' : 'No hay una capa de dibujo disponible.')
    if (layer.locked) return toast.error(`La capa «${layer.name}» está bloqueada.`)
    if (layer.id !== layerId) setLayerId(layer.id)
    const data = buildObjectData(tool, box ?? defaultBox(tool, point)), type = data.type
    if (connect) data.properties = { ...data.properties, connect }
    setTool('select')
    try {
      const [created] = await createRows([{ ...data, pageId, layerId: layer.id, position: topPosition(layer.id) }], 'Crear')
      if (!created) return
      if (type === 'hotspot') {
        openDialog({ kind: 'hotspot', id: created.id })
        await hotspot.mutateAsync({ objectId: created.id, title: 'Nuevo hotspot' })
      } else if (type === 'text') openDialog({ kind: 'text', id: created.id })
    } catch (error) { setSelectedIds([]); fail(error) }
  }

  function commit(changes, mode) {
    const entries = changes.map(({ prev, next }) => {
      const row = current(next.id)
      if (!row) return null
      const data = { transform: next.transform, geometry: next.geometry }
      if (next.properties !== prev.properties) data.properties = next.properties
      return { row, data }
    }).filter(Boolean)
    applyUpdates(entries, LABELS[mode] ?? 'Editar')
  }

  function patch(objects, change, label = 'Editar') {
    applyUpdates(editable(objects).map((row) => ({ row, data: mergePatch(row, change) })), label)
  }

  function remove(objects) {
    const targets = editable(objects)
    if (!targets.length) return
    if (targets.some((row) => row.pending)) return toast.info('Espera un momento: todavía se está guardando.')
    setSelectedIds([])
    batch.mutate(targets.map((row) => ({ op: 'delete', id: row.id, expectedRevision: row.revision })), { onError: fail })
    record(targets.map((row) => ({ id: row.id, before: snapshot(row), after: null })), 'Eliminar')
    toast(targets.length === 1 ? 'Elemento eliminado' : `${targets.length} elementos eliminados`, { action: { label: 'Deshacer', onClick: () => undo() } })
  }

  // Shared by duplicate() and paste(): creates copies of `sources` offset by
  // (dx, dy), re-attaching a hotspot record to each one that needs it.
  async function cloneRows(sources, offset, label) {
    try {
      const created = await createRows(sources.map((row) => ({
        pageId, layerId: row.layerId, type: row.type, position: topPosition(row.layerId),
        transform: { ...row.transform, x: (row.transform?.x ?? 0) + offset, y: (row.transform?.y ?? 0) + offset },
        geometry: row.geometry, style: row.style, properties: row.properties,
      })), label)
      await Promise.all(created.map((object, index) => {
        const source = sources[index]
        if (source.type !== 'hotspot') return null
        return hotspot.mutateAsync({ objectId: object.id, title: `${source.hotspot?.title ?? 'Hotspot'} (copia)`, description: source.hotspot?.description, color: source.hotspot?.color, icon: source.hotspot?.icon, status: source.hotspot?.status })
      }))
    } catch (error) { fail(error) }
  }

  function duplicate(objects) {
    const sources = editable(objects).filter((row) => !row.pending)
    if (!sources.length) return
    return cloneRows(sources, 24, 'Duplicar')
  }

  // Hides/shows or locks/unlocks elements without going through `editable`:
  // an element's own `properties.locked` must not block unlocking it (its
  // layer's lock still does — see onLockedLayer above).
  function setHidden(objects, hidden) {
    const targets = onLockedLayer(objects)
    if (!targets.length) return
    applyUpdates(targets.map((row) => ({ row, data: { properties: { ...(row.properties ?? {}), hidden } } })), hidden ? 'Ocultar' : 'Mostrar')
  }
  function setLocked(objects, locked) {
    const targets = onLockedLayer(objects)
    if (!targets.length) return
    applyUpdates(targets.map((row) => ({ row, data: { properties: { ...(row.properties ?? {}), locked } } })), locked ? 'Bloquear' : 'Desbloquear')
  }

  // convertShape() is a no-op (same reference) when the kind is unchanged.
  function convertShapes(objects, kind) {
    const entries = editable(objects).map((row) => {
      const next = convertShape(row, kind)
      return next === row ? null : { row, data: { type: next.type, geometry: next.geometry, properties: next.properties } }
    }).filter(Boolean)
    applyUpdates(entries, 'Cambiar forma')
  }

  // Moves editable rows to another layer, putting each one on top of it (the
  // Layers panel's drag-and-drop and the quick-actions menu's "Mover a capa"
  // both call this; both already checked the destination isn't locked and
  // accepts the object's type before calling).
  function moveToLayer(objects, targetLayerId) {
    const targets = editable(objects).filter((row) => row.layerId !== targetLayerId)
    if (!targets.length) return
    let next = topPosition(targetLayerId)
    applyUpdates(targets.map((row) => ({ row, data: { layerId: targetLayerId, position: next++ } })), 'Mover a capa')
  }

  // Applies the `{ id, position, layerId? }` patches lib/layerTree.js's
  // moveElement() computes for one drag-and-drop move in the Layers panel.
  function reorderElements(patches) {
    const entries = patches.map((patch) => {
      const row = current(patch.id)
      if (!row) return null
      const data = { position: patch.position }
      if (patch.layerId !== undefined) data.layerId = patch.layerId
      return { row, data }
    }).filter(Boolean)
    applyUpdates(entries, 'Reordenar')
  }

  function copy(objects) {
    const sources = editable(objects).filter((row) => !row.pending).map((row) => snapshot(row))
    if (sources.length) clipboardRef.current = sources
  }
  function paste() {
    const sources = clipboardRef.current
    if (!sources?.length) return
    return cloneRows(sources, 24, 'Pegar')
  }
  const canPaste = () => Boolean(clipboardRef.current?.length)

  function arrange(objects, where) {
    const entries = editable(objects).map((row) => {
      const siblings = rows.filter((item) => item.layerId === row.layerId && item.id !== row.id).map((item) => item.position ?? 0)
      return { row, data: { position: where === 'front' ? Math.max(0, ...siblings) + 1 : Math.min(0, ...siblings) - 1 } }
    })
    applyUpdates(entries, where === 'front' ? 'Traer al frente' : 'Enviar al fondo')
  }

  function nudge(objects, dx, dy) {
    const entries = editable(objects).map((row) => ({ row, data: { transform: { ...row.transform, x: (row.transform?.x ?? 0) + dx, y: (row.transform?.y ?? 0) + dy } } }))
    applyUpdates(entries, 'Desplazar', { coalesce: 'nudge' })
  }

  // Moves editable rows by per-object deltas (align/distribute), one undo step.
  function moveBy(objects, deltas, label) {
    const entries = editable(objects).map((row) => {
      const d = deltas.get(row.id)
      if (!d || (!d.dx && !d.dy)) return null
      return { row, data: { transform: { ...row.transform, x: (row.transform?.x ?? 0) + d.dx, y: (row.transform?.y ?? 0) + d.dy } } }
    }).filter(Boolean)
    applyUpdates(entries, label)
  }
  const align = (objects, mode) => moveBy(objects, alignDeltas(editable(objects), mode), 'Alinear')
  const distribute = (objects, axis) => moveBy(objects, distributeDeltas(editable(objects), axis), 'Distribuir')

  async function replay(direction) {
    const entry = direction === 'undo' ? history.takeUndo() : history.takeRedo()
    if (!entry) return
    bump()
    const ids = entry.changes.map((change) => history.resolveId(change.id))
    if (ids.some((id) => current(id)?.pending)) { history.revert(direction); bump(); return toast.info('Espera un momento: todavía se está guardando.') }
    const operations = buildOperations(entry.changes, direction, rowsRef.current, history.resolveId)
    if (!operations.length) return
    const target = direction === 'undo' ? 'before' : 'after'
    setSelectedIds(entry.changes.filter((change) => change[target]).map((change) => history.resolveId(change.id)))
    try {
      const response = await batch.mutateAsync(operations)
      if ((response?.data ?? response ?? []).some((result) => result.op === 'conflict')) {
        history.revert(direction); bump()
      }
    } catch (error) {
      history.revert(direction); bump()
      toast.error(error?.code === 'REVISION_CONFLICT' || /otra sesión|restaurar/.test(error?.message ?? '') ? 'Otra persona cambió este elemento; no se pudo deshacer.' : error?.message)
    }
  }
  const undo = () => replay('undo')
  const redo = () => replay('redo')

  async function toggleLayer(layer, data) {
    try { await updateLayer.mutateAsync({ pageId, layerId: layer.id, data }) } catch (error) { fail(error) }
  }
  // Boards created before their template had a data layer can add one.
  async function addDataLayer() {
    try { await createLayer.mutateAsync({ pageId, data: { name: 'Datos Runly', type: 'data' } }) } catch (error) { fail(error) }
  }
  async function addPage(count) {
    try { return await createPage.mutateAsync({ name: `Página ${count + 1}` }) } catch (error) { fail(error); return null }
  }

  const media = useMediaInsert({ upload, viewport, size, drawableLayer, layers, lockLayer: (layer) => toggleLayer(layer, { locked: true }), rows, pageId, createRows, fail, calibratePage, hasCalibration })

  const dataLayer = () => layers.find((layer) => layer.type === 'data' && !layer.locked) ?? null

  // Binds a shape and moves it to the page's data layer when there is one.
  function connectData(object, binding) {
    const row = current(object.id)
    if (!row || layerById(row.layerId)?.locked) return
    const target = dataLayer()
    const data = { properties: { ...(row.properties ?? {}), binding } }
    if (target && target.id !== row.layerId) { data.layerId = target.id; data.position = topPosition(target.id) }
    applyUpdates([{ row, data }], 'Conectar a datos')
  }
  function disconnectData(object) {
    const row = current(object.id)
    if (!row) return
    const { binding: _binding, ...properties } = row.properties ?? {}
    applyUpdates([{ row, data: { properties } }], 'Desconectar datos')
  }
  async function insertData(binding, record) {
    const layer = dataLayer() ?? drawableLayer()
    if (!layer) return toast.error('No hay una capa disponible para insertar datos.')
    const center = screenToWorld({ x: size.width / 2, y: size.height / 2 }, viewport)
    const data = buildObjectData('rectangle', { x: center.x - 100, y: center.y - 50, width: 200, height: 100 })
    try {
      await createRows([{ ...data, properties: { ...data.properties, binding, label: record?.title ?? null }, pageId, layerId: layer.id, position: topPosition(layer.id) }], 'Insertar datos')
    } catch (error) { fail(error) }
  }

  // Inserts a library item (spec: docs/superpowers/specs/2026-10-02-canvas-libraries-design.md
  // §8/§23). An `objects` item is centred on `point`: its own shapes go to
  // the active drawing layer, while any hotspot inside it goes to the
  // hotspot layer and gets a fresh hotspot record titled "Hotspot" (a saved
  // hotspot's own title/description/icon are not part of a library item —
  // edge case 6). An `image` item reuses the already-uploaded fileId, sized
  // like a freshly inserted image (fitSize/maxInsertSide).
  async function insertLibraryItem(item, point) {
    if (item.kind === 'image') {
      const layer = drawableLayer()
      if (!layer) return toast.error('No hay una capa de dibujo disponible.')
      const dims = fitSize(item.width ?? 0, item.height ?? 0, maxInsertSide(size, viewport))
      try {
        await createRows([{
          pageId, layerId: layer.id, type: 'image', position: topPosition(layer.id),
          transform: { x: point.x - dims.width / 2, y: point.y - dims.height / 2, rotation: 0, scaleX: 1, scaleY: 1 },
          geometry: dims, style: {}, properties: { fileId: item.fileAssetId, name: item.name, naturalWidth: item.width, naturalHeight: item.height },
        }], 'Insertar de biblioteca')
      } catch (error) { fail(error) }
      return
    }

    const layer = drawableLayer()
    if (!layer) return toast.error('No hay una capa de dibujo disponible.')
    const hotspotLayer = layers.find((candidate) => candidate.type === 'hotspot')
    const payload = item.payload ?? { objects: [], width: 0, height: 0 }
    const origin = { x: point.x - (payload.width ?? 0) / 2, y: point.y - (payload.height ?? 0) / 2 }
    const placed = placeObjects(payload, origin)
    if (!placed.length) return

    let shapePosition = topPosition(layer.id), hotspotPosition = hotspotLayer ? topPosition(hotspotLayer.id) : 0, skippedHotspots = 0
    const datas = []
    for (const object of placed) {
      if (object.type === 'hotspot') {
        if (!hotspotLayer) { skippedHotspots += 1; continue }
        datas.push({ ...object, pageId, layerId: hotspotLayer.id, position: hotspotPosition++ })
      } else {
        datas.push({ ...object, pageId, layerId: layer.id, position: shapePosition++ })
      }
    }
    if (!datas.length) return toast.error('Esta página no tiene capa de hotspots.')
    try {
      const created = await createRows(datas, 'Insertar de biblioteca')
      await Promise.all(created.filter((object) => object.type === 'hotspot').map((object) => hotspot.mutateAsync({ objectId: object.id, title: 'Hotspot' })))
      if (skippedHotspots) {
        toast.info(skippedHotspots === 1 ? 'Se omitió un hotspot: esta página no tiene capa de hotspots.' : `Se omitieron ${skippedHotspots} hotspots: esta página no tiene capa de hotspots.`)
      }
    } catch (error) { fail(error) }
  }

  return {
    batch, hotspot, createPage, updateLayer, ...media,
    chooseTool, create, commit, patch, remove, duplicate, arrange, nudge, align, distribute, toggleLayer, addPage, addDataLayer, addingLayer: createLayer.isPending, undo, redo,
    connectData, disconnectData, insertData, insertLibraryItem,
    setHidden, setLocked, convertShapes, copy, paste, canPaste,
    moveToLayer, reorderElements,
    canUndo: history.canUndo, canRedo: history.canRedo,
    undoLabel: history.peekUndo()?.label ?? null, redoLabel: history.peekRedo()?.label ?? null,
    saving: batch.isPending || hotspot.isPending || updateLayer.isPending || media.inserting,
  }
}
