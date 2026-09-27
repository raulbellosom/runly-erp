import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, MoreHorizontal } from 'lucide-react'
import { Badge } from '../components/Badge.jsx'
import { Button } from '../components/Button.jsx'
import { Card, CardContent } from '../components/Card.jsx'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../components/DropdownMenu.jsx'
import { cn } from '../lib/utils.js'

export function RunlyKanbanCard({ record, schema, columns, canUpdate, onOpen, onMove }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: `record:${record.id}`, disabled: !canUpdate, data: { recordId: record.id } })
  const card = schema.card
  return <Card ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform) }} className={cn('group cursor-pointer border-border/70 bg-card shadow-sm transition hover:-translate-y-0.5 hover:shadow-md', isDragging && 'z-50 opacity-60 shadow-xl')} onClick={() => onOpen?.(record.id)}>
    <CardContent className="p-3">
      <div className="flex items-start gap-2">
        {canUpdate && <button type="button" aria-label="Mover tarjeta" className="mt-0.5 cursor-grab touch-none text-muted-foreground active:cursor-grabbing" onClick={(event) => event.stopPropagation()} {...listeners} {...attributes}><GripVertical className="h-4 w-4" /></button>}
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-semibold text-foreground">{record[card.titleField] ?? 'Sin título'}</p>
          {card.subtitleField && record[card.subtitleField] != null && <p className="mt-1 truncate text-xs text-muted-foreground">{String(record[card.subtitleField])}</p>}
          {card.descriptionField && record[card.descriptionField] != null && <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-muted-foreground">{String(record[card.descriptionField])}</p>}
          {card.badgeField && record[card.badgeField] != null && <Badge variant="secondary" className="mt-2 max-w-full truncate">{String(record[card.badgeField])}</Badge>}
        </div>
        {canUpdate && <DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0 md:hidden" aria-label="Mover a otra columna" onClick={(event) => event.stopPropagation()}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end">{columns.filter((column) => column.acceptsDrop && column.value !== record[schema.groupBy]).map((column) => <DropdownMenuItem key={column.id} onClick={(event) => { event.stopPropagation(); onMove(record.id, column.value) }}>Mover a {column.label}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>}
      </div>
    </CardContent>
  </Card>
}
