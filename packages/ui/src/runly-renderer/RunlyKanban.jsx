import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Columns3 } from 'lucide-react'
import { toast } from 'sonner'
import { EmptyState } from '../components/EmptyState.jsx'
import { ErrorState } from '../components/ErrorState.jsx'
import { PageHeader } from '../components/PageHeader.jsx'
import { Skeleton } from '../components/Skeleton.jsx'
import { RunlyKanbanColumn } from './RunlyKanbanColumn.jsx'
import { columnKey, moveKanbanRecord, recordsForColumn } from './kanban-state.js'

export function RunlyKanban({ blueprint, moduleKey, companyId, queryKanban, updateRecord, onCardClick }) {
  const schema = blueprint.schema
  const queryClient = useQueryClient()
  const queryKey = ['runly-kanban', companyId, moduleKey, blueprint.key]
  const query = useQuery({ queryKey, queryFn: () => queryKanban({ viewKey: blueprint.key }), enabled: Boolean(companyId && moduleKey && blueprint.key) })
  const columns = (query.data?.columns ?? []).map((column, index) => ({ ...column, id: `column:${index}:${columnKey(column.value)}` }))
  const mutation = useMutation({
    mutationFn: ({ id, value }) => updateRecord(schema.apiPath, id, { [schema.groupBy]: value }),
    onMutate: async ({ id, value }) => { await queryClient.cancelQueries({ queryKey }); const previous = queryClient.getQueryData(queryKey); queryClient.setQueryData(queryKey, (current) => moveKanbanRecord(current, id, schema.groupBy, value)); return { previous } },
    onError: (_error, _variables, context) => { if (context?.previous) queryClient.setQueryData(queryKey, context.previous); toast.error('No se pudo mover la tarjeta.') },
    onSuccess: () => toast.success('Tarjeta actualizada.'),
    onSettled: () => { queryClient.invalidateQueries({ queryKey }); queryClient.invalidateQueries({ queryKey: ['runly-dashboard', companyId, moduleKey] }) },
  })
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }), useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  const move = (id, value) => { if (query.data?.canUpdate && !mutation.isPending) mutation.mutate({ id, value }) }
  const onDragEnd = ({ active, over }) => { if (!over) return; const target = columns.find((column) => column.id === over.id); if (target?.acceptsDrop) move(active.data.current?.recordId, target.value) }
  if (query.isLoading) return <div className="space-y-5 p-4 sm:p-6"><Skeleton className="h-16 w-full" /><div className="flex gap-4 overflow-hidden">{[1, 2, 3].map((key) => <Skeleton key={key} className="h-96 w-80 shrink-0 rounded-xl" />)}</div></div>
  if (query.isError) return <div className="p-6"><ErrorState title="No se pudo cargar el Kanban" description="Revisa tu conexión e inténtalo nuevamente." onRetry={() => query.refetch()} /></div>
  return <div className="space-y-5 p-4 sm:p-6"><PageHeader title={schema.title} description={schema.description} />
    {!query.data?.records?.length && <EmptyState variant="compact" icon={Columns3} title="No hay tarjetas todavía" description="Las columnas permanecen disponibles para mostrar el flujo configurado." />}
    {query.data?.truncated && <p className="rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-900">Se muestran los primeros {query.data.limit} registros.</p>}
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}><div className="flex snap-x gap-4 overflow-x-auto pb-4">{columns.map((column) => <div key={column.id} className="snap-start"><RunlyKanbanColumn column={column} columns={columns} records={recordsForColumn(query.data?.records, schema.groupBy, column.value)} schema={schema} canUpdate={query.data?.canUpdate} onOpen={onCardClick} onMove={move} /></div>)}</div></DndContext>
  </div>
}
