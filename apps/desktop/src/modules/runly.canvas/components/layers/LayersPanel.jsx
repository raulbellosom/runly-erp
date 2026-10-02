import { Fragment, useEffect, useRef, useState } from 'react'
import {
  DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger, Button, cn } from '@runly/ui'
import { Database, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { buildLayerTree, moveElement } from '../../lib/layerTree.js'
import { KIND_ORDER, LAYER_KINDS, canHostType, layerKind } from '../../lib/layerKinds.js'
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

// Left panel: pages (collapsible), the layers/elements tree (always open,
// drag-and-drop with handles) and a collapsible "what is each layer" help
// section — adds an element-level view and reordering the previous panel
// did not have.
export function LayersPanel({
  pages, activePageId, onPageChange, onAddPage, addingPage,
  layers, allRows, activeLayerId, onLayerChange, selectedIds, onSelect,
  onToggleLayer, onFocus, onSetHidden, onSetLocked, onReorderLayers, onReorderElements,
  onAddDataLayer, addingLayer = false, readOnly = false,
}) {
  const tree = buildLayerTree(layers, allRows)
  const activePage = pages.find((page) => page.id === activePageId)
  const [expanded, setExpanded] = useState(() => new Set(activeLayerId ? [activeLayerId] : []))
  const [showAllIds, setShowAllIds] = useState(() => new Set())
  const [openItems, setOpenItems] = useState(['layers'])
  const initedRef = useRef(false)

  useEffect(() => {
    if (!activeLayerId) return
    setExpanded((current) => (current.has(activeLayerId) ? current : new Set(current).add(activeLayerId)))
  }, [activeLayerId])

  useEffect(() => {
    if (initedRef.current || !pages.length) return
    initedRef.current = true
    const pagesOpen = readStoredBool(PAGES_KEY, pages.length <= 5)
    const helpOpen = readStoredBool(HELP_KEY, false)
    setOpenItems((current) => {
      const next = new Set(current)
      if (pagesOpen) next.add('pages'); else next.delete('pages')
      if (helpOpen) next.add('help'); else next.delete('help')
      return [...next]
    })
  }, [pages.length])

  function handleAccordionChange(next) {
    setOpenItems(next)
    writeStoredBool(PAGES_KEY, next.includes('pages'))
    writeStoredBool(HELP_KEY, next.includes('help'))
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
    const isLayer = tree.some((layer) => layer.id === active.id)
    if (isLayer) {
      const overIsLayer = tree.some((layer) => layer.id === over.id)
      if (!overIsLayer) return
      const visualOrder = tree.map((layer) => layer.id)
      onReorderLayers(arrayMove(visualOrder, visualOrder.indexOf(active.id), visualOrder.indexOf(over.id)))
      return
    }
    const moved = allRows.find((row) => row.id === active.id)
    if (!moved) return
    const overLayer = tree.find((layer) => layer.id === over.id)
    const hostLayer = overLayer ?? tree.find((layer) => layer.elements.some((element) => element.id === over.id))
    if (!hostLayer) return
    if (hostLayer.locked) return toast.error(`La capa «${hostLayer.name}» está bloqueada.`)
    if (!canHostType(hostLayer, moved.type)) return toast.error('Ese elemento no puede ir en esa capa.')
    const index = overLayer ? 0 : hostLayer.elements.findIndex((element) => element.id === over.id)
    const patches = moveElement(allRows, moved.id, { layerId: hostLayer.id, index })
    if (patches.length) onReorderElements(patches)
  }

  const kinds = new Set(layers.map(layerKind))
  const activeKind = layerKind(layers.find((layer) => layer.id === activeLayerId) ?? {})
  const missingData = !readOnly && layers.length > 0 && !kinds.has('data') && onAddDataLayer

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto overscroll-contain p-3">
      <Accordion type="multiple" value={openItems} onValueChange={handleAccordionChange} className="space-y-2">
        <AccordionItem value="pages">
          <AccordionTrigger>Páginas · {activePage?.name ?? 'Sin páginas'} ({pages.length})</AccordionTrigger>
          <AccordionContent>
            <PagesSection pages={pages} activePageId={activePageId} onPageChange={onPageChange} onAddPage={onAddPage} addingPage={addingPage} readOnly={readOnly} />
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="layers">
          <div className="flex h-9 items-center px-3">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[hsl(var(--muted-foreground))]">Capas</h2>
          </div>
          <AccordionContent>
            {tree.length ? (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={tree.map((layer) => layer.id)} strategy={verticalListSortingStrategy}>
                  <ul className="space-y-0.5">
                    {tree.map((layer) => {
                      const isExpanded = expanded.has(layer.id)
                      const showAll = showAllIds.has(layer.id)
                      const visible = showAll ? layer.elements : layer.elements.slice(0, SHOW_LIMIT)
                      return (
                        <Fragment key={layer.id}>
                          <LayerItem
                            layer={layer} active={layer.id === activeLayerId} expanded={isExpanded} count={layer.elements.length}
                            onToggleExpand={() => toggleExpanded(layer.id)} onSelect={() => onLayerChange(layer.id)}
                            onToggleVisible={() => onToggleLayer(layer, { visible: !layer.visible })}
                            onToggleLocked={() => onToggleLayer(layer, { locked: !layer.locked })}
                            readOnly={readOnly}
                          />
                          {isExpanded ? (
                            <li>
                              <SortableContext items={visible.map((element) => element.id)} strategy={verticalListSortingStrategy}>
                                {visible.length ? (
                                  <ul className="space-y-0.5">
                                    {visible.map((object) => (
                                      <ElementItem
                                        key={object.id} object={object} selected={selectedIds.includes(object.id)}
                                        onSelect={() => onSelect([object.id])} onFocus={() => onFocus(object)}
                                        onToggleVisible={() => onSetHidden([object], !object.properties?.hidden)}
                                        onToggleLocked={() => onSetLocked([object], !object.properties?.locked)}
                                        readOnly={readOnly}
                                      />
                                    ))}
                                  </ul>
                                ) : (
                                  <p className="px-9 py-1.5 text-xs text-[hsl(var(--muted-foreground))]">Sin elementos.</p>
                                )}
                              </SortableContext>
                              {!showAll && layer.elements.length > SHOW_LIMIT ? (
                                <button
                                  type="button"
                                  onClick={() => setShowAllIds((current) => new Set(current).add(layer.id))}
                                  className="w-full px-9 py-1.5 text-left text-xs font-medium text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
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
                </SortableContext>
              </DndContext>
            ) : (
              <p className="px-1 text-xs text-[hsl(var(--muted-foreground))]">Esta página no tiene capas.</p>
            )}
            {missingData ? (
              <Button type="button" variant="outline" size="sm" className="mt-2 w-full" onClick={onAddDataLayer} disabled={addingLayer}>
                {addingLayer ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <Database />}Agregar capa de datos
              </Button>
            ) : null}
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="help">
          <AccordionTrigger>¿Qué es cada capa?</AccordionTrigger>
          <AccordionContent>
            <div className="space-y-1.5 rounded-xl bg-[hsl(var(--muted)/0.5)] p-3 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">
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
