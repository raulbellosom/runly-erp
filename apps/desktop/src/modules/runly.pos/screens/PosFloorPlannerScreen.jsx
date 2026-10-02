import { useState, useEffect, useCallback, useRef } from 'react'
import { Pencil, LayoutGrid, Settings2 } from 'lucide-react'
import {
  Button, SelectField, Badge,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
  Sheet, SheetContent, SheetHeader, SheetTitle,
  TextField, EmptyState,
} from '@runly/ui'
import { DEFAULT_VIEWPORT } from '../../runly.canvas/engine/viewport.js'
import { usePosOutlets } from '../hooks/usePosSettings'
import {
  usePosFloors,
  usePosFloorDetail,
  useCreatePosFloor,
  useUpdatePosFloor,
  useSaveFloorLayout,
  usePublishFloor,
} from '../hooks/usePosFloor'
import { canvasReducer, elementsFromFloor, layoutPayload, useHistoryReducer } from '../lib/floorPlannerState.js'
import { buildPlannerElement } from '../lib/plannerObjects.js'
import FloorPlannerStage from '../components/FloorPlannerStage.jsx'
import FloorToolbox, { FloorToolboxContent } from '../components/FloorToolbox'
import FloorPropertiesPanel from '../components/FloorPropertiesPanel'

export default function PosFloorPlannerScreen() {
  const [outletId, setOutletId] = useState('')
  const [floorId, setFloorId] = useState('')
  const [activeTool, setActiveTool] = useState('SELECT')
  const [selectedId, setSelectedId] = useState(null)

  const [newFloorDialog, setNewFloorDialog] = useState(false)
  const [newFloorName, setNewFloorName] = useState('')
  const [editFloorDialog, setEditFloorDialog] = useState(false)
  const [editFloorName, setEditFloorName] = useState('')
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false)
  const [mobilePropsOpen, setMobilePropsOpen] = useState(false)

  const [viewport, setViewport] = useState(DEFAULT_VIEWPORT)
  const [showGrid, setShowGrid] = useState(true)
  const [toolboxCollapsed, setToolboxCollapsed] = useState(false)
  const [propsCollapsed, setPropsCollapsed] = useState(false)

  const tempIdRef = useRef(0)
  const clipboardRef = useRef(null)
  const [canvas, dispatch, canUndo, canRedo] = useHistoryReducer(canvasReducer, { elements: [], dirty: false })

  // Refs so the keydown closure stays stable (only re-registers on floorId change)
  const selectedIdRef     = useRef(selectedId)
  const canvasElementsRef = useRef(canvas.elements)
  useEffect(() => { selectedIdRef.current = selectedId }, [selectedId])
  useEffect(() => { canvasElementsRef.current = canvas.elements }, [canvas.elements])

  const { data: outlets = [] } = usePosOutlets()
  const { data: floors = [] } = usePosFloors(outletId ? { outletId } : {})
  const { data: floor } = usePosFloorDetail(floorId)

  const createFloor = useCreatePosFloor()
  const updateFloor = useUpdatePosFloor()
  const saveLayout = useSaveFloorLayout()
  const publishFloor = usePublishFloor()

  useEffect(() => {
    if (!floor?.id) return
    dispatch({ type: 'LOAD', elements: elementsFromFloor(floor) })
    setSelectedId(null)
    setActiveTool('SELECT')
  }, [floor?.id])

  // Keyboard shortcuts — uses capture phase so it fires before any child handler.
  // Reads selectedId and canvas.elements via refs to avoid re-registering on every state change.
  // Zoom/pan/fit are handled by the viewport itself (wheel, pinch, Space, floating controls).
  useEffect(() => {
    if (!floorId) return
    function onKeyDown(e) {
      if (e.target.closest('input, textarea, [contenteditable], [role="dialog"]')) return
      const ctrl = e.ctrlKey || e.metaKey
      const sel      = selectedIdRef.current
      const elements = canvasElementsRef.current

      if (ctrl && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault()
        dispatch({ type: 'UNDO' })
        setSelectedId(null)
        return
      }
      if (ctrl && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
        e.preventDefault()
        dispatch({ type: 'REDO' })
        setSelectedId(null)
        return
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel) {
        e.preventDefault()
        dispatch({ type: 'REMOVE', id: sel })
        setSelectedId(null)
        return
      }
      if (ctrl && e.key.toLowerCase() === 'c' && sel) {
        e.preventDefault()
        const el = elements.find((el) => el.id === sel)
        if (el) clipboardRef.current = el
        return
      }
      if (ctrl && e.key.toLowerCase() === 'v' && clipboardRef.current) {
        e.preventDefault()
        const el = clipboardRef.current
        const newId = `temp_${++tempIdRef.current}`
        dispatch({ type: 'ADD', element: { ...el, id: newId, x: el.x + 20, y: el.y + 20 } })
        setSelectedId(newId)
        return
      }
      if (ctrl && e.key.toLowerCase() === 'd' && sel) {
        e.preventDefault()
        const el = elements.find((el) => el.id === sel)
        if (el) {
          const newId = `temp_${++tempIdRef.current}`
          dispatch({ type: 'ADD', element: { ...el, id: newId, x: el.x + 20, y: el.y + 20 } })
          setSelectedId(newId)
        }
        return
      }
      if (e.key === 'Escape') {
        setSelectedId(null)
        setActiveTool('SELECT')
        return
      }
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && sel) {
        e.preventDefault()
        const nudge = e.shiftKey ? 10 : 1
        const el = elements.find((el) => el.id === sel)
        if (!el) return
        const dx = e.key === 'ArrowLeft' ? -nudge : e.key === 'ArrowRight' ? nudge : 0
        const dy = e.key === 'ArrowUp' ? -nudge : e.key === 'ArrowDown' ? nudge : 0
        dispatch({ type: 'MOVE', id: sel, x: el.x + dx, y: el.y + dy })
      }
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [floorId])

  function handleContextAction(action, elementId) {
    switch (action) {
      case 'copy': {
        const el = canvas.elements.find((e) => e.id === elementId)
        if (el) clipboardRef.current = el
        break
      }
      case 'paste': {
        if (!clipboardRef.current) break
        const el = clipboardRef.current
        const newId = `temp_${++tempIdRef.current}`
        dispatch({ type: 'ADD', element: { ...el, id: newId, x: el.x + 20, y: el.y + 20 } })
        setSelectedId(newId)
        break
      }
      case 'duplicate': {
        const el = canvas.elements.find((e) => e.id === elementId)
        if (el) {
          const newId = `temp_${++tempIdRef.current}`
          dispatch({ type: 'ADD', element: { ...el, id: newId, x: el.x + 20, y: el.y + 20 } })
          setSelectedId(newId)
        }
        break
      }
      case 'delete': {
        dispatch({ type: 'REMOVE', id: elementId })
        setSelectedId(null)
        break
      }
      case 'bringForward':
        dispatch({ type: 'BRING_FORWARD', id: elementId })
        break
      case 'sendBackward':
        dispatch({ type: 'SEND_BACKWARD', id: elementId })
        break
    }
  }

  function handleOutletChange(id) {
    setOutletId(id)
    setFloorId('')
    setSelectedId(null)
    dispatch({ type: 'LOAD', elements: [] })
  }

  function handleFloorChange(id) {
    setFloorId(id)
    setSelectedId(null)
  }

  function handlePlace(kind, input) {
    const element = buildPlannerElement(kind, input, canvas.elements)
    if (!element) return
    const newId = `temp_${++tempIdRef.current}`
    dispatch({ type: 'ADD', element: { ...element, id: newId } })
    setSelectedId(newId)
  }

  function handleApply(patches) {
    dispatch({ type: 'APPLY', patches })
  }

  function handleSave() {
    saveLayout.mutate(
      { id: floorId, elements: layoutPayload(canvas.elements) },
      {
        onSuccess: (res) => {
          dispatch({ type: 'LOAD', elements: elementsFromFloor(res?.data ?? res) })
        },
      },
    )
  }

  function handlePublish() {
    publishFloor.mutate(floorId)
  }

  function handleCreateFloor() {
    if (!newFloorName.trim() || !outletId) return
    createFloor.mutate(
      { name: newFloorName.trim(), outletId },
      {
        onSuccess: (res) => {
          const created = res?.data ?? res
          setNewFloorDialog(false)
          setNewFloorName('')
          setFloorId(created.id)
        },
      },
    )
  }

  function openEditFloor() {
    if (!activeFloor) return
    setEditFloorName(activeFloor.name)
    setEditFloorDialog(true)
  }

  function handleEditFloor() {
    if (!editFloorName.trim() || !floorId) return
    updateFloor.mutate(
      { id: floorId, name: editFloorName.trim() },
      { onSuccess: () => setEditFloorDialog(false) },
    )
  }

  const handleUpdate = useCallback(
    (patch) => {
      if (!selectedId) return
      dispatch({ type: 'UPDATE', id: selectedId, patch })
    },
    [selectedId],
  )
  const handleRemove = useCallback(() => {
    if (!selectedId) return
    dispatch({ type: 'REMOVE', id: selectedId })
    setSelectedId(null)
  }, [selectedId])

  const selectedElement = canvas.elements.find((el) => el.id === selectedId) ?? null
  const activeFloor = floors.find((f) => f.id === floorId)

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      <div className="border-b border-border bg-card shrink-0">

        {/* Mobile: 2-row compact layout */}
        <div className="md:hidden">
          <div className="flex items-center justify-between px-4 pt-3 pb-2 gap-3">
            <div className="min-w-0">
              <h1 className="text-sm font-semibold leading-tight truncate">Diseñador de planos</h1>
            </div>
            {floorId && (
              <div className="flex items-center gap-1.5 shrink-0">
                {activeFloor?.isActive && (
                  <Badge variant="secondary" className="text-xs">Activo</Badge>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleSave}
                  disabled={!canvas.dirty || saveLayout.isPending}
                >
                  {saveLayout.isPending ? '...' : 'Guardar'}
                </Button>
                <Button
                  size="sm"
                  onClick={handlePublish}
                  disabled={activeFloor?.isActive || publishFloor.isPending || canvas.dirty}
                >
                  {publishFloor.isPending ? '...' : 'Publicar'}
                </Button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 px-4 pb-3 flex-wrap">
            <div className="flex-1 min-w-0">
              <SelectField
                value={outletId}
                onChange={handleOutletChange}
                options={outlets.map((o) => ({ value: o.id, label: o.name }))}
                placeholder="Sucursal"
              />
            </div>
            <div className="flex-1 min-w-0">
              <SelectField
                value={floorId}
                onChange={handleFloorChange}
                options={floors.map((f) => ({ value: f.id, label: f.name }))}
                placeholder={
                  !outletId ? 'Elige sucursal'
                  : floors.length === 0 ? 'Sin planos'
                  : 'Plano'
                }
                disabled={!outletId}
              />
            </div>
            {outletId && (
              <Button size="sm" variant="outline" onClick={() => setNewFloorDialog(true)}>
                + Plano
              </Button>
            )}
            {floorId && (
              <Button
                size="icon"
                variant="ghost"
                className="h-9 w-9 text-muted-foreground"
                onClick={openEditFloor}
                title="Renombrar plano"
              >
                <Pencil size={14} />
              </Button>
            )}
          </div>
        </div>

        {/* Desktop: compact single-row layout */}
        <div className="hidden md:flex items-center gap-3 px-4 py-1.5 flex-wrap">
          <h1 className="text-sm font-semibold shrink-0">Diseñador de planos</h1>
          <div className="w-px h-4 bg-border/60 shrink-0" />
          <div className="flex items-center gap-2 flex-1 min-w-0 flex-wrap">
            <div className="w-44">
              <SelectField
                value={outletId}
                onChange={handleOutletChange}
                options={outlets.map((o) => ({ value: o.id, label: o.name }))}
                placeholder="Sucursal"
              />
            </div>
            <div className="w-44">
              <SelectField
                value={floorId}
                onChange={handleFloorChange}
                options={floors.map((f) => ({ value: f.id, label: f.name }))}
                placeholder={
                  !outletId
                    ? 'Elige sucursal primero'
                    : floors.length === 0
                      ? 'Sin planos'
                      : 'Plano'
                }
                disabled={!outletId}
              />
            </div>
            {outletId && (
              <Button size="sm" variant="outline" onClick={() => setNewFloorDialog(true)}>
                + Plano
              </Button>
            )}
            {floorId && (
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={openEditFloor}
                title="Renombrar plano"
              >
                <Pencil size={14} />
              </Button>
            )}
          </div>
          {floorId && (
            <div className="flex items-center gap-2 shrink-0">
              {activeFloor?.isActive && (
                <Badge variant="secondary" className="text-xs">Activo</Badge>
              )}
              {canvas.dirty && (
                <span className="text-xs text-muted-foreground hidden sm:inline">Sin guardar</span>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={handleSave}
                disabled={!canvas.dirty || saveLayout.isPending}
              >
                {saveLayout.isPending ? 'Guardando...' : 'Guardar'}
              </Button>
              <Button
                size="sm"
                onClick={handlePublish}
                disabled={activeFloor?.isActive || publishFloor.isPending || canvas.dirty}
              >
                {publishFloor.isPending ? 'Publicando...' : 'Publicar'}
              </Button>
            </div>
          )}
        </div>
      </div>

      {!floorId ? (
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            title={outletId ? 'Selecciona o crea un plano' : 'Selecciona una sucursal'}
            description={
              outletId
                ? 'Elige un plano existente o crea uno nuevo con el botón "+ Plano".'
                : 'Elige la sucursal en la barra superior para ver sus planos.'
            }
          />
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          {/* Toolbox sidebar — desktop only */}
          <div className="hidden md:block md:shrink-0">
            <FloorToolbox
              activeTool={activeTool}
              onToolChange={setActiveTool}
              collapsed={toolboxCollapsed}
              onToggleCollapse={() => setToolboxCollapsed((c) => !c)}
            />
          </div>

          {/* Canvas */}
          <div className="relative flex-1 overflow-hidden">
            <FloorPlannerStage
              floor={floor}
              elements={canvas.elements}
              selectedId={selectedId}
              onSelect={setSelectedId}
              activeTool={activeTool}
              onToolDone={() => setActiveTool('SELECT')}
              onApply={handleApply}
              onPlace={handlePlace}
              onContextAction={handleContextAction}
              clipboardAvailable={clipboardRef.current != null}
              showGrid={showGrid}
              onShowGridChange={setShowGrid}
              viewport={viewport}
              onViewportChange={setViewport}
            />

            {/* Mobile floating action buttons */}
            <div className="md:hidden absolute bottom-4 left-3 flex flex-col gap-2 z-20">
              <button
                type="button"
                onClick={() => setMobileToolsOpen(true)}
                className="flex items-center gap-2 h-10 px-3.5 rounded-xl bg-card border border-border shadow-md text-sm font-medium text-foreground active:scale-95 transition-transform"
              >
                <LayoutGrid size={15} />
                Elementos
              </button>
              {selectedElement && (
                <button
                  type="button"
                  onClick={() => setMobilePropsOpen(true)}
                  className="flex items-center gap-2 h-10 px-3.5 rounded-xl bg-primary text-primary-foreground shadow-md text-sm font-medium active:scale-95 transition-transform"
                >
                  <Settings2 size={15} />
                  Editar
                </button>
              )}
            </div>
          </div>

          {/* Properties panel — desktop only, always rendered so collapse works */}
          <div className="hidden md:block md:shrink-0">
            <FloorPropertiesPanel
              element={selectedElement}
              onUpdate={handleUpdate}
              onRemove={handleRemove}
              collapsed={propsCollapsed}
              onToggleCollapse={() => setPropsCollapsed((c) => !c)}
            />
          </div>
        </div>
      )}

      {/* ── Mobile Sheets ─────────────────────────────────────────────────── */}

      {/* Toolbox sheet */}
      <Sheet open={mobileToolsOpen} onOpenChange={setMobileToolsOpen}>
        <SheetContent side="bottom" aria-describedby={undefined}>
          <SheetHeader>
            <SheetTitle>Elementos</SheetTitle>
          </SheetHeader>
          <div className="overflow-y-auto -mx-6 px-2">
            <FloorToolboxContent
              activeTool={activeTool}
              onToolChange={(t) => { setActiveTool(t); setMobileToolsOpen(false) }}
              showHints={false}
            />
          </div>
        </SheetContent>
      </Sheet>

      {/* Properties sheet */}
      <Sheet open={mobilePropsOpen} onOpenChange={setMobilePropsOpen}>
        <SheetContent side="bottom" aria-describedby={undefined}>
          <SheetHeader>
            <SheetTitle>Propiedades</SheetTitle>
          </SheetHeader>
          {selectedElement && (
            <FloorPropertiesPanel
              element={selectedElement}
              onUpdate={handleUpdate}
              onRemove={() => { handleRemove(); setMobilePropsOpen(false) }}
              className="flex flex-col overflow-y-auto"
            />
          )}
        </SheetContent>
      </Sheet>

      <Dialog open={newFloorDialog} onOpenChange={(v) => { setNewFloorDialog(v); if (!v) setNewFloorName('') }}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Nuevo plano</DialogTitle>
            <DialogDescription>Dale un nombre al plano de esta sucursal.</DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <TextField
              label="Nombre del plano"
              placeholder="Ej. Planta baja, Terraza..."
              value={newFloorName}
              onChange={(e) => setNewFloorName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateFloor()}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setNewFloorDialog(false); setNewFloorName('') }}>
              Cancelar
            </Button>
            <Button onClick={handleCreateFloor} disabled={!newFloorName.trim() || createFloor.isPending}>
              {createFloor.isPending ? 'Creando...' : 'Crear plano'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editFloorDialog} onOpenChange={setEditFloorDialog}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Renombrar plano</DialogTitle>
            <DialogDescription>Cambia el nombre de "{activeFloor?.name}".</DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <TextField
              label="Nombre del plano"
              value={editFloorName}
              onChange={(e) => setEditFloorName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleEditFloor()}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditFloorDialog(false)}>Cancelar</Button>
            <Button onClick={handleEditFloor} disabled={!editFloorName.trim() || updateFloor.isPending}>
              {updateFloor.isPending ? 'Guardando...' : 'Guardar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
