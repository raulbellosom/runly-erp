import { useState } from 'react'
import {
  Checkbox,
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@runly/ui'
import { X, CornerDownRight } from 'lucide-react'
import { toast } from 'sonner'
import {
  useUpdateTask, useAddAssignee, useRemoveAssignee,
  useProjectMembers, useStatuses,
} from '../hooks/useProjectsData'
import { AssigneeAvatar } from '../lib/AssigneeChip.jsx'
import { UserPickerDropdown } from '../lib/UserPickerDropdown.jsx'

export function SubtaskRow({ task, projectId, onDelete, onOpen }) {
  const updateSubtask = useUpdateTask(projectId)
  const addAssignee = useAddAssignee(projectId, task.id)
  const removeAssignee = useRemoveAssignee(projectId, task.id)
  const { data: membersData } = useProjectMembers(projectId)
  const { data: statusesData } = useStatuses(projectId)
  const members = membersData?.data ?? membersData ?? []
  const statuses = statusesData?.data ?? statusesData ?? []

  const [title, setTitle] = useState(task.title)
  const [editing, setEditing] = useState(false)
  const [showAssignPicker, setShowAssignPicker] = useState(false)

  const currentStatus = statuses.find((s) => s.id === task.statusId)

  function handleBlur() {
    setEditing(false)
    const trimmed = title.trim()
    if (!trimmed) { setTitle(task.title); return }
    if (trimmed !== task.title) {
      updateSubtask.mutate({ taskId: task.id, title: trimmed }, {
        onError: () => { setTitle(task.title); toast.error('No se pudo guardar') },
      })
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') e.target.blur()
    if (e.key === 'Escape') { setTitle(task.title); setEditing(false) }
  }

  function toggleDone(v) {
    updateSubtask.mutate({ taskId: task.id, isDone: Boolean(v) }, {
      onError: () => toast.error('No se pudo actualizar'),
    })
  }

  function handleStatusChange(statusId) {
    updateSubtask.mutate({ taskId: task.id, statusId }, {
      onError: () => toast.error('No se pudo cambiar el estado'),
    })
  }

  const primaryAssignee = task.assignees?.[0]?.user ?? task.assignee ?? null
  const memberUsers = members.map((m) => ({ ...(m.user ?? m), id: m.userId ?? m.user?.id ?? m.id }))

  function handleAssigneeChange(userId) {
    if (!userId) return
    setShowAssignPicker(false)
    if (primaryAssignee?.id === userId) {
      removeAssignee.mutate({ userId }, { onError: () => toast.error('No se pudo quitar asignado') })
    } else {
      addAssignee.mutate({ userId }, { onError: () => toast.error('No se pudo asignar') })
    }
  }

  return (
    <div className="flex items-center gap-2 py-1.5 group">
      <Checkbox
        checked={task.isDone ?? false}
        onCheckedChange={toggleDone}
      />
      <CornerDownRight size={10} className="text-indigo-400/70 shrink-0" />

      {/* Status indicator dot */}
      {statuses.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="shrink-0 rounded-full transition-opacity opacity-70 hover:opacity-100"
              title={currentStatus?.name ?? 'Sin estado'}
            >
              <span
                className="block w-2.5 h-2.5 rounded-full border border-white/20"
                style={{ background: currentStatus?.color ?? '#888' }}
              />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-36">
            {statuses.map((s) => (
              <DropdownMenuItem
                key={s.id}
                onSelect={() => handleStatusChange(s.id)}
                className="gap-2 text-sm"
              >
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.color }} />
                {s.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {editing ? (
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          className="flex-1 text-sm bg-transparent border-b border-border outline-none focus:border-primary"
        />
      ) : (
        <span
          onClick={() => setEditing(true)}
          className={`flex-1 text-sm cursor-text select-none ${task.isDone ? 'line-through text-muted-foreground' : ''}`}
        >
          {title}
        </span>
      )}

      {showAssignPicker ? (
        <div className="w-52 shrink-0">
          <UserPickerDropdown
            users={memberUsers}
            value={primaryAssignee?.id ?? ''}
            onChange={handleAssigneeChange}
            placeholder="Asignar..."
            emptyMessage="Sin miembros"
            compact
            autoFocus
            onBlur={() => setShowAssignPicker(false)}
          />
        </div>
      ) : (
        <button
          onClick={(e) => { e.stopPropagation(); setShowAssignPicker(true) }}
          className="shrink-0 opacity-60 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
          tabIndex={-1}
          title="Asignar miembro"
        >
          {primaryAssignee
            ? <AssigneeAvatar user={primaryAssignee} size="sm" />
            : <span className="w-5 h-5 rounded-full border border-dashed border-muted-foreground/40 flex items-center justify-center text-[9px] text-muted-foreground">+</span>
          }
        </button>
      )}

      {onOpen && (
        <button
          onClick={() => onOpen(task.id)}
          className="text-muted-foreground hover:text-foreground transition-colors opacity-60 md:opacity-0 md:group-hover:opacity-100 shrink-0"
          tabIndex={-1}
          title="Abrir subtarea"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
            <polyline points="15 3 21 3 21 9"/>
            <line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
        </button>
      )}

      <button
        onClick={() => onDelete(task.id)}
        className="text-muted-foreground hover:text-destructive transition-colors opacity-60 md:opacity-0 md:group-hover:opacity-100 shrink-0"
        tabIndex={-1}
      >
        <X size={12} />
      </button>
    </div>
  )
}
