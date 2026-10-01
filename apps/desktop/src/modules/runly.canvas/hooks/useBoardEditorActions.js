import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { buildObjectData, defaultBox } from '../lib/objectFactory.js'
import { buildOperations, createHistory, snapshot } from '../lib/history.js'
import { useCreateHotspot, useCreatePage, useObjectBatch, useUpdateLayer, useUploadFile } from './useCanvasData.js'
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
export function useBoardEditorActions({ boardId, pageId, rows, layers, layerId, setLayerId, setSelectedIds, setTool, viewport, size, openDialog }) {
  // Undo can fire later (e.g. from a toast action), so replays read the
  // latest rows instead of the ones captured when the callback was created.
  const rowsRef = useRef(rows)
  useLayoutEffect(() => { rowsRef.current = rows })
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
  const createPage = useCreatePage(boardId), updateLayer = useUpdateLayer(boardId), upload = useUploadFile()

  const fail = (error) => toast.error(error?.message ?? 'No se pudo guardar el cambio.')
  const layerById = (id) => layers.find((layer) => layer.id === id)
  const current = (id) => rowsRef.current.find((row) => row.id === id)
  const editable = (objects) => objects.map((object) => current(object?.id)).filter((row) => row && !layerById(row.layerId)?.locked)
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

  async function create({ tool, box, point }) {
    const layer = layerForTool(tool)
    if (!layer) return toast.error(tool === 'hotspot' ? 'Esta página no tiene capa de hotspots.' : 'No hay una capa de dibujo disponible.')
    if (layer.locked) return toast.error(`La capa «${layer.name}» está bloqueada.`)
    if (layer.id !== layerId) setLayerId(layer.id)
    const data = buildObjectData(tool, box ?? defaultBox(tool, point)), type = data.type
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
    const entries = changes.map(({ next }) => ({ row: current(next.id), data: { transform: next.transform, geometry: next.geometry } })).filter((entry) => entry.row)
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

  async function duplicate(objects) {
    const sources = editable(objects).filter((row) => !row.pending)
    if (!sources.length) return
    try {
      const created = await createRows(sources.map((row) => ({
        pageId, layerId: row.layerId, type: row.type, position: topPosition(row.layerId),
        transform: { ...row.transform, x: (row.transform?.x ?? 0) + 24, y: (row.transform?.y ?? 0) + 24 },
        geometry: row.geometry, style: row.style, properties: row.properties,
      })), 'Duplicar')
      await Promise.all(created.map((object, index) => {
        const source = sources[index]
        if (source.type !== 'hotspot') return null
        return hotspot.mutateAsync({ objectId: object.id, title: `${source.hotspot?.title ?? 'Hotspot'} (copia)`, description: source.hotspot?.description, color: source.hotspot?.color, status: source.hotspot?.status })
      }))
    } catch (error) { fail(error) }
  }

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
    try { await batch.mutateAsync(operations) } catch (error) {
      history.revert(direction); bump()
      toast.error(error?.code === 'REVISION_CONFLICT' || /otra sesión|restaurar/.test(error?.message ?? '') ? 'Otra persona cambió este elemento; no se pudo deshacer.' : error?.message)
    }
  }
  const undo = () => replay('undo')
  const redo = () => replay('redo')

  async function toggleLayer(layer, data) {
    try { await updateLayer.mutateAsync({ pageId, layerId: layer.id, data }) } catch (error) { fail(error) }
  }
  async function addPage(count) {
    try { return await createPage.mutateAsync({ name: `Página ${count + 1}` }) } catch (error) { fail(error); return null }
  }

  const media = useMediaInsert({ upload, viewport, size, drawableLayer, rows, pageId, createRows, fail })

  return {
    batch, hotspot, createPage, updateLayer, ...media,
    chooseTool, create, commit, patch, remove, duplicate, arrange, nudge, toggleLayer, addPage, undo, redo,
    canUndo: history.canUndo, canRedo: history.canRedo,
    undoLabel: history.peekUndo()?.label ?? null, redoLabel: history.peekRedo()?.label ?? null,
    saving: batch.isPending || hotspot.isPending || updateLayer.isPending || media.inserting,
  }
}
