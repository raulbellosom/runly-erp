import { useState, useEffect } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, TextField, SelectField, DatePickerField,
} from '@runly/ui'
import { toast } from 'sonner'
import { useCreateTask, useStatuses, useWorkspaceUsers } from '../hooks/useProjectsData'

const PRIORITY_OPTIONS = [
  { value: 'NONE',   label: 'Normal' },
  { value: 'LOW',    label: 'Baja' },
  { value: 'MEDIUM', label: 'Media' },
  { value: 'HIGH',   label: 'Alta' },
  { value: 'URGENT', label: 'Urgente' },
]

export default function TaskFormModal({ open, onOpenChange, projectId, defaultStatusId }) {
  const { data: statusesData } = useStatuses(projectId)
  const statuses = statusesData?.data ?? statusesData ?? []
  const { data: usersData } = useWorkspaceUsers(projectId)
  const users = usersData?.users ?? usersData?.data ?? usersData ?? []
  const createTask = useCreateTask(projectId)

  const defaultStatus = defaultStatusId ?? statuses.find((s) => s.isDefault)?.id ?? statuses[0]?.id ?? ''

  const [title, setTitle] = useState('')
  const [statusId, setStatusId] = useState(defaultStatus)
  const [priority, setPriority] = useState('NONE')
  const [assigneeId, setAssigneeId] = useState('')
  const [dueDate, setDueDate] = useState(null)

  useEffect(() => {
    if (open) {
      setTitle('')
      setStatusId(defaultStatusId ?? statuses.find((s) => s.isDefault)?.id ?? statuses[0]?.id ?? '')
      setPriority('NONE')
      setAssigneeId('__none__')
      setDueDate(null)
    }
  }, [open])

  useEffect(() => {
    if (statuses.length && !statusId) {
      setStatusId(defaultStatusId ?? statuses.find((s) => s.isDefault)?.id ?? statuses[0]?.id ?? '')
    }
  }, [statuses.length, defaultStatusId])

  function handleSubmit(e) {
    e.preventDefault()
    const trimmed = title.trim()
    if (!trimmed || !statusId) return
    createTask.mutate(
      {
        title: trimmed,
        statusId,
        priority,
        assigneeId: assigneeId === '__none__' ? null : assigneeId || null,
        dueDate: dueDate || null,
      },
      {
        onSuccess: () => {
          toast.success('Tarea creada')
          onOpenChange(false)
        },
        onError: () => toast.error('No se pudo crear la tarea'),
      },
    )
  }

  const statusOptions = statuses.map((s) => ({ value: s.id, label: s.name }))
  const userOptions = [
    { value: '__none__', label: 'Sin asignar' },
    ...users.map((u) => ({ value: u.id, label: (u.displayName ?? [u.firstName, u.lastName].filter(Boolean).join(' ')) || u.email || u.id })),
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nueva tarea</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <TextField
            label="Titulo"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Nombre de la tarea"
            required
            autoFocus
          />
          <SelectField
            label="Estado"
            value={statusId}
            onValueChange={setStatusId}
            options={statusOptions}
          />
          <SelectField
            label="Prioridad"
            value={priority}
            onValueChange={setPriority}
            options={PRIORITY_OPTIONS}
          />
          <SelectField
            label="Asignado a"
            value={assigneeId}
            onValueChange={setAssigneeId}
            options={userOptions}
          />
          <DatePickerField
            label="Fecha vencimiento"
            value={dueDate}
            onChange={setDueDate}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!title.trim() || !statusId || createTask.isPending}>
              Crear tarea
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
