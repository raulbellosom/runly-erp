import { FileText, Users } from 'lucide-react'
import { templateMeta, timeAgo } from '../lib/boardMeta.js'

const DOT_GRID = { backgroundImage: 'radial-gradient(hsl(var(--muted-foreground) / 0.28) 1px, transparent 1px)', backgroundSize: '16px 16px' }

export function BoardCard({ board, onOpen }) {
  const template = templateMeta(board.templateType), Icon = template.icon
  const pages = board._count?.pages ?? 0, collaborators = board._count?.collaborators ?? 0
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex w-full cursor-pointer flex-col overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-left shadow-sm transition-[box-shadow,border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
    >
      <div className="relative flex aspect-[16/9] items-center justify-center bg-[hsl(var(--muted)/0.5)]" style={DOT_GRID}>
        <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--muted-foreground))] shadow-sm transition-colors group-hover:text-primary">
          <Icon className="h-5 w-5" />
        </span>
        <span className="absolute left-3 top-3 rounded-full bg-[hsl(var(--card)/0.9)] px-2 py-0.5 text-[11px] font-medium text-[hsl(var(--muted-foreground))] backdrop-blur">
          {template.label}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <h3 className="line-clamp-2 font-semibold leading-snug text-[hsl(var(--foreground))]" title={board.name}>{board.name}</h3>
        {board.description ? <p className="line-clamp-2 text-sm text-[hsl(var(--muted-foreground))]">{board.description}</p> : null}
        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-2 text-xs text-[hsl(var(--muted-foreground))]">
          <span className="inline-flex items-center gap-1 tabular-nums"><FileText className="h-3.5 w-3.5" />{pages} {pages === 1 ? 'página' : 'páginas'}</span>
          {collaborators > 1 ? <span className="inline-flex items-center gap-1 tabular-nums"><Users className="h-3.5 w-3.5" />{collaborators}</span> : null}
          {board.updatedAt ? <span className="ml-auto">Editado {timeAgo(board.updatedAt)}</span> : null}
        </div>
      </div>
    </button>
  )
}

export function BoardCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]" aria-hidden>
      <div className="aspect-[16/9] animate-pulse bg-[hsl(var(--muted))] motion-reduce:animate-none" />
      <div className="space-y-2 p-4">
        <div className="h-4 w-2/3 animate-pulse rounded bg-[hsl(var(--muted))] motion-reduce:animate-none" />
        <div className="h-3 w-1/3 animate-pulse rounded bg-[hsl(var(--muted))] motion-reduce:animate-none" />
      </div>
    </div>
  )
}
