import { Badge, cn } from '@runly/ui'
import { GripVertical } from 'lucide-react'
import { CatalogRowActions } from './CatalogRowActions.jsx'

export function CatalogListRow({ icon: Icon, color = '#7c3aed', title, subtitle, badges = [], dragHandleProps, isDragging, onEdit, onDelete }) {
  return (
    <div className={cn('flex items-center gap-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2.5', isDragging && 'opacity-50 shadow-lg')}>
      {dragHandleProps ? (
        <button {...dragHandleProps} type="button" aria-label="Arrastrar para reordenar" className="shrink-0 cursor-grab touch-none text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]">
          <GripVertical className="h-4 w-4" />
        </button>
      ) : null}
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: `${color}22`, color }}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-[hsl(var(--foreground))]">{title}</p>
        {subtitle ? <p className="truncate text-xs text-[hsl(var(--muted-foreground))]">{subtitle}</p> : null}
      </div>
      <div className="hidden shrink-0 gap-1.5 sm:flex">
        {badges.map((badge) => <Badge key={badge} variant="outline" className="text-xs">{badge}</Badge>)}
      </div>
      <CatalogRowActions name={title} onEdit={onEdit} onDelete={onDelete} />
    </div>
  )
}
