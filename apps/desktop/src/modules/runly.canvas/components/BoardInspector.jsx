import { MousePointerClick, Users } from 'lucide-react'
import { bindingKey, canBind } from '../lib/dataBindings.js'
import { DataBindingSection } from './inspector/DataBindingSection.jsx'
import { EntityLinksSection } from './inspector/EntityLinksSection.jsx'
import { MeasuresSection } from './inspector/MeasuresSection.jsx'
import { MultiInspector } from './inspector/MultiInspector.jsx'
import { ObjectInspector } from './inspector/ObjectInspector.jsx'
import { BoardSettingsSection } from './inspector/BoardSettingsSection.jsx'
import { Section } from './inspector/fields.jsx'

export function BoardInspector({ boardId, selectedRows, layers, lockedLayerIds, links, bindings, presence, actions, settings, onSettingsChange, scale = null, readOnly = false }) {
  const single = selectedRows.length === 1 ? selectedRows[0] : null
  const linkTarget = single && single.type !== 'hotspot' && !single.pending ? { targetType: 'OBJECT', targetId: single.id } : null
  const dataKey = single ? bindingKey(single.properties?.binding) : null
  return (
    <div className="flex h-full min-h-0 flex-col gap-6 overflow-y-auto overscroll-contain p-3 pb-6">
      {single ? (
        <ObjectInspector
          object={single}
          layerName={layers.find((layer) => layer.id === single.layerId)?.name}
          locked={lockedLayerIds.has(single.layerId)}
          readOnly={readOnly}
          onPatch={(change) => actions.patch([single], change)}
          onHotspotChange={(data) => actions.hotspotChange(single, data)}
          onDelete={() => actions.remove([single])}
          onDuplicate={() => actions.duplicate([single])}
          onArrange={(where) => actions.arrange([single], where)}
          onOpenHotspot={() => actions.openHotspot(single)}
          onEditText={() => actions.editText(single)}
          onConvert={(kind) => actions.convertShapes([single], kind)}
        >
          <MeasuresSection object={single} scale={scale} />
          {canBind(single) ? (
            <DataBindingSection
              object={single}
              data={dataKey ? bindings?.[dataKey] : undefined}
              readOnly={readOnly}
              locked={lockedLayerIds.has(single.layerId)}
              onConnect={() => actions.openDataDialog(single)}
              onDisconnect={() => actions.disconnectData(single)}
            />
          ) : null}
          {linkTarget ? <EntityLinksSection boardId={boardId} links={links} readOnly={readOnly} {...linkTarget} /> : null}
        </ObjectInspector>
      ) : selectedRows.length > 1 && readOnly ? (
        <p className="px-1 text-sm text-[hsl(var(--muted-foreground))]">{selectedRows.length} elementos seleccionados.</p>
      ) : selectedRows.length > 1 ? (
        <MultiInspector
          rows={selectedRows}
          lockedCount={selectedRows.filter((row) => lockedLayerIds.has(row.layerId)).length}
          onPatch={(rows, change) => actions.patch(rows, change)}
          onDelete={() => actions.remove(selectedRows)}
          onDuplicate={() => actions.duplicate(selectedRows)}
          onArrange={(where) => actions.arrange(selectedRows, where)}
          onAlign={(mode) => actions.align(selectedRows, mode)}
          onDistribute={(axis) => actions.distribute(selectedRows, axis)}
        />
      ) : (
        <>
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-[hsl(var(--border))] px-4 py-6 text-center">
            <MousePointerClick className="h-5 w-5 text-[hsl(var(--muted-foreground))]" />
            <p className="text-sm text-[hsl(var(--muted-foreground))]">Selecciona un elemento para editar su posición, tamaño, colores y vínculos.</p>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              Shift + clic o arrastrar en un área vacía para seleccionar varios. En pantallas táctiles, mantén presionado. Doble clic abre hotspots y textos.
            </p>
          </div>
          <BoardSettingsSection settings={settings} onChange={onSettingsChange} readOnly={readOnly} />
        </>
      )}

      <Section title="Conectados ahora">
        {presence.length ? (
          <ul className="space-y-1">
            {presence.map((user) => (
              <li key={user.id} className="flex items-center gap-2.5 rounded-lg px-1 py-1.5 text-sm">
                <span className="relative flex h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-hidden />
                <span className="truncate">{user.name}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="flex items-center gap-2 px-1 text-sm text-[hsl(var(--muted-foreground))]"><Users className="h-4 w-4 shrink-0" />Nadie más está viendo este Board en este momento.</p>
        )}
      </Section>
    </div>
  )
}
