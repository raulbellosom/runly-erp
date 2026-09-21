import { useState } from 'react'
import {
  DndContext, closestCenter, PointerSensor, TouchSensor, KeyboardSensor,
  useSensor, useSensors, DragOverlay, useDroppable,
} from '@dnd-kit/core'
import {
  SortableContext, verticalListSortingStrategy,
  useSortable, sortableKeyboardCoordinates,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Plus, GripVertical, AlertCircle, CornerDownRight, Layers, Lock, RefreshCw, Paperclip, ArrowRight } from 'lucide-react'
import {
  EmptyState,
  Input,
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from '@runly/ui'
import { toast } from 'sonner'
import { useStatuses, useTasks, useMoveTask, useCreateTask } from '../hooks/useProjectsData'
import { AssigneeAvatar, StackedAssignees } from '../lib/AssigneeChip.jsx'

const PRIORITY_COLORS = {
  URGENT: 'bg-red-500/20 text-red-400 border-red-500/30',
  HIGH: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  MEDIUM: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  LOW: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
  NONE: '',
}

const PRIORITY_LABELS = {
  URGENT: 'Urgente', HIGH: 'Alta', MEDIUM: 'Media', LOW: 'Baja', NONE: '',
}

function parseDateSafe(d) {
  if (!d) return null
  const str = String(d)
  const part = str.includes('T') ? str.slice(0, 10) : str
  return new Date(`${part}T12:00:00`)
}

function isOverdue(dueDate) {
  if (!dueDate) return false
  return parseDateSafe(dueDate) < new Date()
}

function formatDate(d) {
  if (!d) return null
  return parseDateSafe(d).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })
}

function TaskCard({ task, statusColor, onClick, isDragging, statuses, currentStatusId, onMove }) {
  const { listeners, setNodeRef, transform, transition } = useSortable({ id: task.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    borderLeftColor: statusColor ? `${statusColor}99` : undefined,
    borderLeftWidth: statusColor ? '3px' : undefined,
  }
  const otherStatuses = statuses?.filter((s) => s.id !== currentStatusId) ?? []
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group bg-background border border-border rounded p-2.5 cursor-pointer hover:border-accent-foreground/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent transition-colors"
      onClick={() => onClick(task.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick(task.id);
        }
      }}
      tabIndex={0}
      role="button"
    >
      <div className="flex items-start gap-1.5">
        {/* Grip handle: listeners only here so the card body stays scrollable on mobile */}
        <span
          {...listeners}
          className="mt-0.5 opacity-30 md:opacity-0 md:group-hover:opacity-100 cursor-grab active:cursor-grabbing text-muted-foreground touch-none p-0.5 -m-0.5 shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical size={14} />
        </span>
        {task.parentTaskId && (
          <CornerDownRight size={10} className="text-indigo-400/70 mt-0.5 shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          {task.taskNumber != null && (
            <span className="text-[10px] text-muted-foreground font-mono block mb-0.5">T-{task.taskNumber}</span>
          )}
          <span className="text-sm leading-snug line-clamp-2">{task.title}</span>
        </div>
      </div>
      <div className="flex items-center gap-1.5 mt-2 ml-4">
        {task.priority !== 'NONE' && (
          <span className={`text-xs border rounded px-1 ${PRIORITY_COLORS[task.priority]}`}>
            {PRIORITY_LABELS[task.priority]}
          </span>
        )}
        {task._count?.subtasks > 0 && (
          <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
            <Layers size={12} />
            {task._count.subtasks}
          </span>
        )}
        {task._count?.attachments > 0 && (
          <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
            <Paperclip size={12} />
            {task._count.attachments}
          </span>
        )}
        {task.blockedBy?.length > 0 && (
          <span className="flex items-center gap-0.5 text-xs text-amber-500" title="Tarea bloqueada">
            <Lock size={11} />
          </span>
        )}
        {task.rrule && (
          <span className="flex items-center gap-0.5 text-xs text-indigo-400" title="Tarea recurrente">
            <RefreshCw size={11} />
          </span>
        )}
        <StackedAssignees assignees={task.assignees} fallback={task.assignee} />
        <div className="flex items-center gap-1 ml-auto">
          {task.startDate && (
            <span className="text-xs text-muted-foreground">{formatDate(task.startDate)}</span>
          )}
          {task.startDate && task.dueDate && (
            <span className="text-xs text-muted-foreground">→</span>
          )}
          {task.dueDate && (
            <span className={`text-xs ${isOverdue(task.dueDate) ? 'text-red-400 font-medium' : 'text-muted-foreground'}`}>
              {isOverdue(task.dueDate) && <AlertCircle size={10} className="inline mr-0.5" />}
              {formatDate(task.dueDate)}
            </span>
          )}
          {otherStatuses.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="md:hidden flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground p-0.5 rounded transition-colors"
                  onClick={(e) => e.stopPropagation()}
                  aria-label="Mover a columna"
                >
                  <ArrowRight size={12} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                <DropdownMenuLabel className="text-xs">Mover a</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {otherStatuses.map((s) => (
                  <DropdownMenuItem
                    key={s.id}
                    onSelect={() => onMove(task.id, s.id)}
                    className="text-sm gap-2"
                  >
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.color }} />
                    {s.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    </div>
  )
}

function QuickCreateInput({ statusId, projectId, onDone }) {
  const [value, setValue] = useState('')
  const createTask = useCreateTask(projectId)
  function submit(e) {
    e.preventDefault()
    const title = value.trim()
    if (!title) return
    createTask.mutate({ title, statusId }, {
      onSuccess: () => { setValue(''); onDone() },
      onError: () => toast.error('No se pudo crear la tarea'),
    })
  }
  return (
    <form onSubmit={submit} className="mt-2">
      <Input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && onDone()}
        placeholder="Nombre de la tarea..."
      />
    </form>
  )
}

function DroppableColumn({ id, children }) {
  const { setNodeRef } = useDroppable({ id })
  return (
    <div ref={setNodeRef} className="flex-1 bg-muted/50 rounded-lg p-2 space-y-2 min-h-30 overflow-y-auto">
      {children}
    </div>
  )
}

export default function KanbanView({ projectId, onTaskClick, showSubtasks = false }) {
  const { data: statusesData } = useStatuses(projectId)
  const { data: tasksData } = useTasks(projectId, {
    ...(showSubtasks ? { include_subtasks: 'true' } : { parentTaskId: 'null' }),
  })
  const statuses = statusesData?.data ?? statusesData ?? []
  const tasks = tasksData?.data ?? tasksData ?? []
  const moveTask = useMoveTask(projectId)
  const [activeId, setActiveId] = useState(null)
  const [quickCreate, setQuickCreate] = useState(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const tasksByStatus = {}
  for (const s of statuses) {
    tasksByStatus[s.id] = tasks
      .filter((t) => t.statusId === s.id)
      .sort((a, b) => a.position - b.position)
  }

  function handleDragStart({ active }) {
    setActiveId(active.id)
  }

  function handleDragEnd({ active, over }) {
    setActiveId(null)
    if (!over || active.id === over.id) return
    const task = tasks.find((t) => t.id === active.id)
    if (!task) return

    const overTask = tasks.find((t) => t.id === over.id)
    const targetStatusId = overTask ? overTask.statusId : over.id
    const targetTasks = tasksByStatus[targetStatusId] ?? []
    const position = overTask
      ? targetTasks.findIndex((t) => t.id === over.id)
      : targetTasks.length

    moveTask.mutate(
      { taskId: task.id, statusId: targetStatusId, position },
      { onError: () => toast.error('No se pudo mover la tarea') },
    )
  }

  const activeTask = activeId ? tasks.find((t) => t.id === activeId) : null

  if (statuses.length === 0) {
    return (
      <EmptyState
        title="Sin columnas"
        description="Este proyecto no tiene columnas de estado. Usa el icono de configuracion para agregar columnas."
      />
    )
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-4 p-4 h-full overflow-x-auto">
        {statuses.map((status) => {
          const colTasks = tasksByStatus[status.id] ?? []
          return (
            <div key={status.id} className="shrink-0 w-72 flex flex-col">
              <div className="flex items-center gap-2 mb-2 px-1">
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ background: status.color }}
                />
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground truncate flex-1">
                  {status.name}
                </span>
                <span className="text-xs text-muted-foreground">{colTasks.length}</span>
              </div>
              <DroppableColumn id={status.id}>
                <SortableContext
                  items={colTasks.map((t) => t.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {colTasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      statusColor={status.color}
                      onClick={onTaskClick}
                      isDragging={task.id === activeId}
                      statuses={statuses}
                      currentStatusId={status.id}
                      onMove={(taskId, targetStatusId) =>
                        moveTask.mutate(
                          { taskId, statusId: targetStatusId, position: (tasksByStatus[targetStatusId]?.length ?? 0) },
                          { onError: () => toast.error('No se pudo mover la tarea') },
                        )
                      }
                    />
                  ))}
                </SortableContext>
                {quickCreate === status.id ? (
                  <QuickCreateInput
                    statusId={status.id}
                    projectId={projectId}
                    onDone={() => setQuickCreate(null)}
                  />
                ) : (
                  <button
                    onClick={() => setQuickCreate(status.id)}
                    className="w-full text-left text-xs text-muted-foreground hover:text-foreground py-1 px-1 rounded transition-colors flex items-center gap-1"
                  >
                    <Plus size={12} />
                    Agregar tarea
                  </button>
                )}
              </DroppableColumn>
            </div>
          )
        })}
      </div>
      <DragOverlay>
        {activeTask && (
          <div className="bg-background border border-accent-foreground/30 rounded p-2.5 shadow-xl text-sm w-64">
            {activeTask.title}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}
