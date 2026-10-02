import { useState } from 'react'
import { ActionMenu } from '@runly/ui'
import { FileText, Pencil, Trash2, Users } from 'lucide-react'
import { templateIcon, timeAgo } from '../lib/boardMeta.js'
import { useCanvasTemplates } from '../hooks/useCanvasData.js'
import { canEditBoard, roleLabel } from '../lib/roles.js'

const DOT_GRID = { backgroundImage: 'radial-gradient(hsl(var(--muted-foreground) / 0.28) 1px, transparent 1px)', backgroundSize: '16px 16px' }
const FIELD_LABEL = { name: 'Nombre', description: 'Descripción', page: 'Página', hotspot: 'Hotspot', text: 'Texto', link: 'Registro' }

// Not a `<button>` anymore: a card-wide button sits absolutely underneath
// (so clicking anywhere still opens the Board) while the "Más opciones"
// menu is a sibling button on top — a menu button can't live inside
// another interactive button (invalid, nested controls).
export function BoardCard({ board, onOpen, thumbnailUrl, matches, onRename, onDelete }) {
  const templates = useCanvasTemplates()
  const template = templates.data?.find((item) => item.key === board.templateType)
  const Icon = templateIcon(template?.icon), templateLabel = template?.label ?? 'Board'
  const pages = board._count?.pages ?? 0, collaborators = board._count?.collaborators ?? 0
  const [failed, setFailed] = useState(false)
  const showThumbnail = Boolean(thumbnailUrl) && !failed
  const menuItems = [
    onRename && canEditBoard(board.myRole) ? { label: 'Renombrar', icon: Pencil, onClick: onRename } : null,
    onDelete && board.myRole === 'OWNER' ? { label: 'Eliminar', icon: Trash2, onClick: onDelete, variant: 'destructive' } : null,
  ].filter(Boolean)
  return (
    <div className="group relative flex w-full flex-col overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-left shadow-sm transition-[box-shadow,border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md motion-reduce:transition-none motion-reduce:hover:translate-y-0">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Abrir ${board.name}`}
        className="absolute inset-0 z-0 cursor-pointer rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2"
      />
      <div className="pointer-events-none relative flex aspect-[16/9] items-center justify-center bg-[hsl(var(--muted)/0.5)]" style={showThumbnail ? undefined : DOT_GRID}>
        {showThumbnail ? (
          <img src={thumbnailUrl} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" onError={() => setFailed(true)} />
        ) : (
          <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--muted-foreground))] shadow-sm transition-colors group-hover:text-primary">
            <Icon className="h-5 w-5" />
          </span>
        )}
        <span className="absolute left-3 top-3 z-10 rounded-full bg-[hsl(var(--card)/0.9)] px-2 py-0.5 text-[11px] font-medium text-[hsl(var(--muted-foreground))] backdrop-blur">
          {templateLabel}
        </span>
        {board.myRole && board.myRole !== 'OWNER' ? (
          <span className="absolute right-3 top-3 z-10 rounded-full bg-[hsl(var(--card)/0.9)] px-2 py-0.5 text-[11px] font-medium text-[hsl(var(--foreground))] backdrop-blur">
            Compartido · {roleLabel(board.myRole)}
          </span>
        ) : null}
      </div>
      <div className="pointer-events-none relative flex flex-1 flex-col gap-1.5 p-4">
        {menuItems.length ? (
          <div className="pointer-events-auto absolute right-2 top-2 z-10 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100">
            <ActionMenu items={menuItems} label="Más opciones" />
          </div>
        ) : null}
        <h3 className="line-clamp-2 pr-8 font-semibold leading-snug text-[hsl(var(--foreground))]" title={board.name}>{board.name}</h3>
        {board.description ? <p className="line-clamp-2 text-sm text-[hsl(var(--muted-foreground))]">{board.description}</p> : null}
        {matches?.length ? (
          <p className="truncate text-xs text-[hsl(var(--muted-foreground))]">
            Coincide en: {matches.map((match) => `${FIELD_LABEL[match.field] ?? match.field}: ${match.snippet || match.label}`).join(' · ')}
          </p>
        ) : null}
        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-2 text-xs text-[hsl(var(--muted-foreground))]">
          <span className="inline-flex items-center gap-1 tabular-nums"><FileText className="h-3.5 w-3.5" />{pages} {pages === 1 ? 'página' : 'páginas'}</span>
          {collaborators > 1 ? <span className="inline-flex items-center gap-1 tabular-nums"><Users className="h-3.5 w-3.5" />{collaborators}</span> : null}
          {board.updatedAt ? <span className="ml-auto">Editado {timeAgo(board.updatedAt)}</span> : null}
        </div>
      </div>
    </div>
  )
}
