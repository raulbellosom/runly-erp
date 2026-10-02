import { Fragment, useEffect, useRef, useState } from 'react'
import {
  DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors,
} from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger, Button, cn } from '@runly/ui'
import { Database, Loader2 } from 'lucide-react'
import { buildLayerTree, moveElement } from '../../lib/layerTree.js'
import { KIND_ORDER, LAYER_KINDS, layerKind } from '../../lib/layerKinds.js'
import { ElementItem } from './ElementItem.jsx'
import { LayerItem } from './LayerItem.jsx'
import { PagesSection } from './PagesSection.jsx'

const SHOW_LIMIT = 50
const PAGES_KEY = 'runly.canvas.panel.pages'
const HELP_KEY = 'runly.canvas.panel.help'

function readStoredBool(key, fallback) {
  try { const raw = window.localStorage.getItem(key); return raw === null ? fallback : raw === '1' } catch { return fallback }
}
function writeStoredBool(key, value) {
  try { window.localStorage.setItem(key, value ? '1' : '0') } catch { /* private mode or quota — ignore */ }
}

// Drag-and-drop only changes element order inside the element's current
// layer. Moving elements between layers remains an explicit menu action.
export function LayersPanel({
  boardId, pages, activePageId, onPageChange, onAddPage, addingPage,
  layers, allRows, activeLayerId, onLayerChange, selectedIds, onSelect,
  onToggleLayer, onFocus, onSetHidden, onSetLocked, onReorderElements,
  onAddDataLayer, addingLayer = false, readOnly = false,
}) {
  const tree = buildLayerTree(layers, allRows)
  const activePage = pages.find((page) => page.id === activePageId)
  const [expanded, setExpanded] = useState(() => new Set(activeLayerId ? [activeLayerId] : []))
  const [showAllIds, setShowAllIds] = useState(() => new Set())
  const [pagesOpen, setPagesOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const initedRef = useRef(false)

  useEffect(() => {
    if (!activeLayerId) return
    setExpanded((current) => (current.has(activeLayerId) ? current : new Set(current).add(activeLayerId)))
  }, [activeLayerId])

  useEffect(() => {
    if (initedRef.current || !pages.length) return
    initedRef.current = true
    setPagesOpen(readStoredBool(PAGES_KEY, pages.length <= 5))
    setHelpOpen(readStoredBool(HELP_KEY, false))
  }, [pages.length])

  function handlePagesChange(next) {
    const open = next === 'pages'
    setPagesOpen(open)
    writeStoredBool(PAGES_KEY, open)
  }

  function handleHelpChange(next) {
    const open = next === 'help'
    setHelpOpen(open)
    writeStoredBool(HELP_KEY, open)
  }

  const toggleExpanded = (layerId) => setExpanded((current) => {
    const next = new Set(current)
    if (next.has(layerId)) next.delete(layerId); else next.add(layerId)
    return next
  })

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function handleDragEnd({ active, over }) {
    if (!over || active.id === over.id) return
    const moved = allRows.find((row) => row.id === active.id)
    if (!moved) return
    const sourceLayer = tree.find((layer) => layer.id === moved.layerId)
    const targetLayer = tree.find((layer) => layer.elements.some((element) => element.id === over.id))
    if (!sourceLayer || targetLayer?.id !== sourceLayer.id || sourceLayer.locked) return
    const index = sourceLayer.elements.findIndex((element) => element.id === over.id)
    if (index < 0) return
    const patches = moveElement(allRows, moved.id, { layerId: sourceLayer.id, index })
    if (patches.length) onReorderElements(patches)
  }

  const kinds = new Set(layers.map(layerKind))
  const activeKind = layerKind(layers.find((layer) => layer.id === activeLayerId) ?? {})
  const missingData = !readOnly && layers.length > 0 && !kinds.has('data') && onAddDataLayer

  return (
    <div className="flex h-full min-h-0 flex-col p-3">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pr-0.5">
        <Accordion type="single" collapsible value={pagesOpen ? 'pages' : ''} onValueChange={handlePagesChange}>
          <AccordionItem value="pages">
            <AccordionTrigger>Páginas · {activePage?.name ?? 'Sin páginas'} ({pages.length})</AccordionTrigger>
            <AccordionContent>
              <PagesSection boardId={boardId} pages={pages} activePageId={activePageId} onPageChange={onPageChange} onAddPage={onAddPage} addingPage={addingPage} readOnly={readOnly} />
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        <section aria-labelledby="canvas-layers-title">
          <div className="flex h-9 items-center px-1">
            <h2 id="canvas-layers-title" className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[hsl(var(--muted-foreground))]">Capas</h2>
          </div>
          {tree.length ? (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <ul className="space-y-1">
                {tree.map((layer) => {
                  const isExpanded = expanded.has(layer.id)
                  const showAll = showAllIds.has(layer.id)
                  const visible = showAll ? layer.elements : layer.elements.slice(0, SHOW_LIMIT)
                  return (
                    <Fragment key={layer.id}>
                      <LayerItem
                        layer={layer} active={layer.id === activeLayerId} expanded={isExpanded} count={layer.elements.length}
                        onActivate={() => { onLayerChange(layer.id); toggleExpanded(layer.id) }}
                        onToggleVisible={() => onToggleLayer(layer, { visible: !layer.visible })}
                        onToggleLocked={() => onToggleLayer(layer, { locked: !layer.locked })}
                        readOnly={readOnly}
                      />
                      {isExpanded ? (
                        <li className="pb-1">
                          <SortableContext items={visible.map((element) => element.id)} strategy={verticalListSortingStrategy}>
                            {visible.length ? (
                              <ul className="ml-4 space-y-0.5 border-l border-[hsl(var(--border))] pl-2">
                                {visible.map((object) => (
                                  <ElementItem
                                    key={object.id} object={object} selected={selectedIds.includes(object.id)}
                                    onSelect={() => onSelect([object.id])} onFocus={() => onFocus(object)}
                                    onToggleVisible={() => onSetHidden([object], !object.properties?.hidden)}
                                    onToggleLocked={() => onSetLocked([object], !object.properties?.locked)}
                                    dragDisabled={readOnly || layer.locked || object.properties?.locked}
                                    readOnly={readOnly}
                                  />
                                ))}
                              </ul>
                            ) : (
                              <p className="px-7 py-2 text-xs text-[hsl(var(--muted-foreground))]">Sin elementos.</p>
                            )}
                          </SortableContext>
                          {!showAll && layer.elements.length > SHOW_LIMIT ? (
                            <button
                              type="button"
                              onClick={() => setShowAllIds((current) => new Set(current).add(layer.id))}
                              className="w-full rounded-md px-7 py-2 text-left text-xs font-medium text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted)/0.5)] hover:text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                            >
                              Mostrar todos ({layer.elements.length})
                            </button>
                          ) : null}
                        </li>
                      ) : null}
                    </Fragment>
                  )
                })}
              </ul>
            </DndContext>
          ) : (
            <p className="px-1 py-2 text-xs text-[hsl(var(--muted-foreground))]">Esta página no tiene capas.</p>
          )}
          {missingData ? (
            <Button type="button" variant="outline" size="sm" className="mt-2 w-full" onClick={onAddDataLayer} disabled={addingLayer}>
              {addingLayer ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <Database />}Agregar capa de datos
            </Button>
          ) : null}
        </section>
      </div>

      <Accordion type="single" collapsible value={helpOpen ? 'help' : ''} onValueChange={handleHelpChange} className="mt-auto shrink-0 pt-2">
        <AccordionItem value="help">
          <AccordionTrigger>¿Qué es cada capa?</AccordionTrigger>
          <AccordionContent className="max-h-64 overflow-y-auto">
            <div className="space-y-2 rounded-lg bg-[hsl(var(--muted)/0.5)] p-3 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">
              <p>Los nombres cambian según la plantilla; el ícono y la etiqueta indican el <strong className="font-semibold text-[hsl(var(--foreground))]">tipo</strong> de cada capa:</p>
              {KIND_ORDER.filter((key) => kinds.has(key)).map((key) => {
                const { icon: KindIcon, label, help } = LAYER_KINDS[key]
                return (
                  <p key={key} className={cn('flex gap-1.5', key === activeKind && 'text-[hsl(var(--foreground))]')}>
                    <KindIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span><strong className="font-semibold text-[hsl(var(--foreground))]">{label}:</strong> {help}</span>
                  </p>
                )
              })}
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  )
}
