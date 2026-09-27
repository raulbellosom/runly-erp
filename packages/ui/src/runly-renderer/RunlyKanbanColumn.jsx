import { useDroppable } from '@dnd-kit/core'
import { Badge } from '../components/Badge.jsx'
import { RunlyKanbanCard } from './RunlyKanbanCard.jsx'
import { cn } from '../lib/utils.js'

export function RunlyKanbanColumn({ column, records, schema, columns, canUpdate, onOpen, onMove }) {
  const { isOver, setNodeRef } = useDroppable({ id: column.id, disabled: !canUpdate || !column.acceptsDrop, data: { value: column.value } })
  return <section ref={setNodeRef} className={cn('flex w-[82vw] max-w-[22rem] shrink-0 flex-col rounded-xl border border-border/70 bg-muted/35 p-3 sm:w-80', isOver && 'border-primary/60 bg-primary/5 ring-2 ring-primary/15')} aria-label={column.label}>
    <header className="mb-3 flex items-center justify-between gap-2 px-1"><h2 className="truncate text-sm font-semibold">{column.label}</h2><Badge variant="outline">{records.length}</Badge></header>
    <div className="flex min-h-24 flex-col gap-2.5">{records.map((record) => <RunlyKanbanCard key={record.id} record={record} schema={schema} columns={columns} canUpdate={canUpdate} onOpen={onOpen} onMove={onMove} />)}{records.length === 0 && <div className="grid min-h-24 place-items-center rounded-lg border border-dashed border-border px-4 text-center text-xs text-muted-foreground">Suelta una tarjeta aquí</div>}</div>
  </section>
}
