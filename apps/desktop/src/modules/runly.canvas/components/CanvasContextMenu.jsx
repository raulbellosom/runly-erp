import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuPortal,
  DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger, useIsMobile,
} from '@runly/ui'
import {
  ArrowDownToLine, ArrowUpToLine, CheckSquare, Clipboard, ClipboardPaste, Copy, Database, Eye, EyeOff,
  FolderInput, Library, ListPlus, LocateFixed, Lock, LockOpen, Maximize, MapPin, Pencil, Shapes, Trash2,
} from 'lucide-react'
import { canBind } from '../lib/dataBindings.js'
import { canHostType } from '../lib/layerKinds.js'
import { SHAPE_KINDS, shapeKindOf } from '../lib/shapeConvert.js'

const SHAPE_OPTIONS = {
  closed: [
    { value: 'rectangle', label: 'Rectángulo' }, { value: 'ellipse', label: 'Elipse' },
    { value: 'triangle', label: 'Triángulo' }, { value: 'diamond', label: 'Rombo' },
  ],
  linear: [{ value: 'line', label: 'Línea' }, { value: 'arrow', label: 'Flecha' }],
}

function shapeFamilyOf(object) {
  const kind = shapeKindOf(object)
  if (SHAPE_KINDS.closed.includes(kind)) return 'closed'
  if (SHAPE_KINDS.linear.includes(kind)) return 'linear'
  return null
}

// Quick-actions menu: right click on the canvas, a long press on touch (see
// CanvasViewport's armLongPress), or Shift+F10 / the ContextMenu key over
// the current selection (see hooks/useContextMenuState.js, which builds
// `menu`). A controlled DropdownMenu whose trigger is an invisible 1×1 point
// at `menu.x`/`menu.y` — the canvas container BoardEditor renders this
// inside must be `position: relative` for that to line up.
//
// `menu.selection` drives the actions that apply to a whole group
// (Duplicar, Copiar, Traer al frente/Enviar al fondo, Ocultar, Bloquear,
// Mover a capa, Eliminar); `menu.target` (only meaningful when the
// selection has exactly one element) drives the single-object ones
// (Enfocar, Editar texto/Abrir hotspot, Cambiar forma, Conectar a datos).
export function CanvasContextMenu({
  menu, onClose, layers, lockedLayerIds, readOnly, canPaste,
  onFocus, onEditText, onOpenHotspot, onDuplicate, onCopy, onPaste, onConvert, onMoveToLayer,
  onArrange, onToggleHidden, onToggleLocked, onConnectData, onDelete, onSelectAll, onFit, onAddToSelection, onSaveToLibrary,
}) {
  // Phones: nested sub-menus open off-screen, so their options are listed
  // inline under a heading and the menu scrolls.
  const flat = useIsMobile()
  const target = menu?.target ?? null
  const selection = menu?.selection ?? []
  const single = selection.length === 1 ? (target ?? selection[0]) : null
  const rowLocked = (row) => Boolean(row?.properties?.locked) || lockedLayerIds.has(row?.layerId)
  const layerLocked = (row) => lockedLayerIds.has(row?.layerId)
  const anyEditable = selection.some((row) => !rowLocked(row))
  const anyUnlockable = selection.some((row) => !layerLocked(row))
  const primary = single ?? selection[0] ?? null
  const hidden = Boolean(primary?.properties?.hidden)
  const locked = Boolean(primary?.properties?.locked)
  const shapeFamily = single ? shapeFamilyOf(single) : null
  const moveTargets = selection.length
    ? layers.filter((layer) => !layer.locked && selection.every((row) => canHostType(layer, row.type)) && !(selection.length === 1 && selection[0].layerId === layer.id))
    : []

  return (
    <DropdownMenu open={Boolean(menu)} onOpenChange={(open) => { if (!open) onClose() }}>
      <DropdownMenuTrigger asChild>
        <span aria-hidden className="pointer-events-none absolute h-px w-px" style={{ left: menu?.x ?? 0, top: menu?.y ?? 0 }} />
      </DropdownMenuTrigger>
      {menu ? (
        <DropdownMenuContent align="start" className={flat ? 'max-h-[70vh] overflow-y-auto overscroll-contain' : undefined}>
          {readOnly ? (
            <>
              {target ? <DropdownMenuItem onSelect={() => onFocus(target)}><LocateFixed />Enfocar</DropdownMenuItem> : null}
              {target?.type === 'hotspot' ? <DropdownMenuItem onSelect={() => onOpenHotspot(target)}><MapPin />Ver hotspot</DropdownMenuItem> : null}
              {target ? <DropdownMenuItem onSelect={() => onCopy([target])}><Clipboard />Copiar</DropdownMenuItem> : null}
              <DropdownMenuItem onSelect={onFit}><Maximize />Ajustar vista</DropdownMenuItem>
            </>
          ) : selection.length ? (
            <>
              {single ? <DropdownMenuItem onSelect={() => onFocus(single)}><LocateFixed />Enfocar</DropdownMenuItem> : null}
              {single?.type === 'text' && !rowLocked(single) ? <DropdownMenuItem onSelect={() => onEditText(single)}><Pencil />Editar texto</DropdownMenuItem> : null}
              {single?.type === 'hotspot' ? <DropdownMenuItem onSelect={() => onOpenHotspot(single)}><MapPin />Información del hotspot</DropdownMenuItem> : null}
              {menu.addSelection ? <DropdownMenuItem onSelect={() => onAddToSelection(menu.addSelection)}><ListPlus />Agregar a la selección</DropdownMenuItem> : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={!anyEditable} onSelect={() => onDuplicate(selection)}><Copy />Duplicar</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onCopy(selection)}><Clipboard />Copiar</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onSaveToLibrary(selection)}><Library />Guardar en biblioteca</DropdownMenuItem>
              {shapeFamily && flat ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-xs text-[hsl(var(--muted-foreground))]">Cambiar forma</DropdownMenuLabel>
                  {SHAPE_OPTIONS[shapeFamily].map((option) => (
                    <DropdownMenuItem key={option.value} disabled={!anyEditable || option.value === shapeKindOf(single)} onSelect={() => onConvert([single], option.value)} className="pl-8">
                      {option.label}
                    </DropdownMenuItem>
                  ))}
                </>
              ) : null}
              {shapeFamily && !flat ? (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger disabled={!anyEditable}><Shapes />Cambiar forma</DropdownMenuSubTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuSubContent>
                      {SHAPE_OPTIONS[shapeFamily].map((option) => (
                        <DropdownMenuItem key={option.value} disabled={option.value === shapeKindOf(single)} onSelect={() => onConvert([single], option.value)}>
                          {option.label}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuPortal>
                </DropdownMenuSub>
              ) : null}
              {flat ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-xs text-[hsl(var(--muted-foreground))]">Mover a capa</DropdownMenuLabel>
                  {moveTargets.length && anyEditable
                    ? moveTargets.map((layer) => <DropdownMenuItem key={layer.id} onSelect={() => onMoveToLayer(selection, layer.id)} className="pl-8">{layer.name}</DropdownMenuItem>)
                    : <DropdownMenuItem disabled className="pl-8">No hay otra capa disponible</DropdownMenuItem>}
                  <DropdownMenuSeparator />
                </>
              ) : (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger disabled={!anyEditable || !moveTargets.length}><FolderInput />Mover a capa</DropdownMenuSubTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuSubContent>
                      <DropdownMenuLabel>Mover a</DropdownMenuLabel>
                      {moveTargets.length
                        ? moveTargets.map((layer) => <DropdownMenuItem key={layer.id} onSelect={() => onMoveToLayer(selection, layer.id)}>{layer.name}</DropdownMenuItem>)
                        : <DropdownMenuItem disabled>No hay otra capa disponible</DropdownMenuItem>}
                    </DropdownMenuSubContent>
                  </DropdownMenuPortal>
                </DropdownMenuSub>
              )}
              <DropdownMenuItem disabled={!anyEditable} onSelect={() => onArrange(selection, 'front')}><ArrowUpToLine />Traer al frente</DropdownMenuItem>
              <DropdownMenuItem disabled={!anyEditable} onSelect={() => onArrange(selection, 'back')}><ArrowDownToLine />Enviar al fondo</DropdownMenuItem>
              <DropdownMenuItem disabled={!anyUnlockable} onSelect={() => onToggleHidden(selection, !hidden)}>
                {hidden ? <Eye /> : <EyeOff />}{hidden ? 'Mostrar' : 'Ocultar'}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!anyUnlockable} onSelect={() => onToggleLocked(selection, !locked)}>
                {locked ? <LockOpen /> : <Lock />}{locked ? 'Desbloquear' : 'Bloquear'}
              </DropdownMenuItem>
              {single && canBind(single) ? (
                <DropdownMenuItem disabled={layerLocked(single)} onSelect={() => onConnectData(single)}><Database />Conectar a datos</DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={!anyEditable} onSelect={() => onDelete(selection)} className="text-destructive focus:bg-destructive/10 focus:text-destructive">
                <Trash2 />Eliminar
              </DropdownMenuItem>
            </>
          ) : (
            <>
              <DropdownMenuItem disabled={!canPaste()} onSelect={onPaste}><ClipboardPaste />Pegar</DropdownMenuItem>
              <DropdownMenuItem onSelect={onSelectAll}><CheckSquare />Seleccionar todo</DropdownMenuItem>
              <DropdownMenuItem onSelect={onFit}><Maximize />Ajustar vista</DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      ) : null}
    </DropdownMenu>
  )
}
