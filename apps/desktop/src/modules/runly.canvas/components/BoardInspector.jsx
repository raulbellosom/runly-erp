import { MousePointerClick, Users } from 'lucide-react'
import { EntityLinksSection } from './inspector/EntityLinksSection.jsx'
import { ObjectInspector } from './inspector/ObjectInspector.jsx'
import { Section } from './inspector/fields.jsx'

export function BoardInspector({ boardId, selected, layerName, locked, links, presence, actions }) {
  const linkTarget = selected?.type === 'hotspot'
    ? (selected.hotspot ? { targetType: 'HOTSPOT', targetId: selected.hotspot.id } : null)
    : selected && !selected.pending ? { targetType: 'OBJECT', targetId: selected.id } : null
  return (
    <div className="flex h-full min-h-0 flex-col gap-6 overflow-y-auto overscroll-contain p-3 pb-6">
      {selected ? (
        <ObjectInspector
          object={selected}
          layerName={layerName}
          locked={locked}
          onPatch={actions.patch}
          onDelete={actions.remove}
          onDuplicate={actions.duplicate}
          onArrange={actions.arrange}
          onOpenHotspot={actions.openHotspot}
          onEditText={actions.editText}
        >
          {linkTarget && selected.type !== 'hotspot' ? <EntityLinksSection boardId={boardId} links={links} {...linkTarget} /> : null}
        </ObjectInspector>
      ) : (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-[hsl(var(--border))] px-4 py-6 text-center">
          <MousePointerClick className="h-5 w-5 text-[hsl(var(--muted-foreground))]" />
          <p className="text-sm text-[hsl(var(--muted-foreground))]">Selecciona un elemento para editar su posición, tamaño, colores y vínculos.</p>
          <p className="text-xs text-[hsl(var(--muted-foreground))]">Doble clic en un hotspot o texto para abrirlo.</p>
        </div>
      )}

      <Section title="En este Board">
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
          <p className="flex items-center gap-2 px-1 text-sm text-[hsl(var(--muted-foreground))]"><Users className="h-4 w-4" />Solo tú por ahora.</p>
        )}
      </Section>
    </div>
  )
}
