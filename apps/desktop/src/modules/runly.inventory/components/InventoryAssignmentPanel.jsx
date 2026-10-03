import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Badge,
  Button,
  Card,
  ComboboxField,
  MarkdownField,
  ConfirmDialog,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
  EmptyState,
  PersonAvatar,
} from '@runly/ui'
import { UserCheck, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../../auth/AuthProvider'
import { runly } from '../../../lib/runly'
import {
  useAssignInventoryItem,
  useReturnInventoryItem,
  useInventoryItemAssignments,
} from '../hooks/useInventoryItems.js'

function formatDate(str) {
  if (!str) return '—'
  return new Date(str).toLocaleDateString('es-PE', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

function AssignmentHistoryRow({ record }) {
  const active = !record.returnedAt
  const name = [record.employee?.firstName, record.employee?.lastName].filter(Boolean).join(' ') || record.employeeName || '—'
  return (
    <div className="flex items-start gap-3 py-2 border-b border-[hsl(var(--border)/0.5)] last:border-0">
      <PersonAvatar name={name} src={record.employee?.avatarUrl} size="sm" className="mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{name}</p>
        <p className="text-xs text-[hsl(var(--muted-foreground))]">
          {formatDate(record.assignedAt)}
          {record.returnedAt ? ` → ${formatDate(record.returnedAt)}` : ' — activo'}
        </p>
        {record.notes && (
          <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5 italic">{record.notes}</p>
        )}
      </div>
      {active && (
        <Badge variant="success" className="shrink-0">Activo</Badge>
      )}
    </div>
  )
}

export function InventoryAssignmentPanel({ item }) {
  const { session } = useAuth()
  const token = session?.access_token

  const [assignOpen, setAssignOpen] = useState(false)
  const [returnOpen, setReturnOpen] = useState(false)
  const [selectedEmployee, setSelectedEmployee] = useState('')
  const [notes, setNotes] = useState('')

  const assignItem = useAssignInventoryItem()
  const returnItem = useReturnInventoryItem()

  const assignmentsQuery = useInventoryItemAssignments(item.id)
  const assignments = useMemo(() => {
    const raw = assignmentsQuery.data?.data ?? assignmentsQuery.data ?? []
    return [...raw].sort((a, b) => new Date(b.assignedAt) - new Date(a.assignedAt))
  }, [assignmentsQuery.data])

  const employeesQuery = useQuery({
    queryKey: ['hr', 'employees', 'options'],
    queryFn: () => runly.hr.listEmployees(token),
    enabled: Boolean(token) && assignOpen,
    staleTime: 5 * 60 * 1000,
  })
  const employeeOptions = useMemo(() => {
    const raw = employeesQuery.data?.data ?? employeesQuery.data ?? []
    return raw.map(e => ({ value: e.id, label: [e.firstName, e.lastName].filter(Boolean).join(' ') || e.id }))
  }, [employeesQuery.data])

  async function handleAssign() {
    if (!selectedEmployee) {
      toast.error('Selecciona un empleado')
      return
    }
    try {
      await assignItem.mutateAsync({ itemId: item.id, employeeId: selectedEmployee, notes: notes || undefined })
      toast.success('Activo asignado')
      setAssignOpen(false)
      setSelectedEmployee('')
      setNotes('')
    } catch (err) {
      toast.error(err?.message ?? 'Error al asignar')
    }
  }

  async function handleReturn() {
    try {
      await returnItem.mutateAsync({ itemId: item.id })
      setReturnOpen(false)
      toast.success('Activo devuelto')
    } catch (err) {
      toast.error(err?.message ?? 'Error al registrar devolucion')
    }
  }

  const isAssigned = Boolean(item.assignedTo?.id ?? item.assignedToId)
  const busy = assignItem.isPending || returnItem.isPending
  const assignedToName = [item.assignedTo?.firstName, item.assignedTo?.lastName].filter(Boolean).join(' ') || '—'

  return (
    <>
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Asignacion</h3>
          {isAssigned ? (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setReturnOpen(true)}
              disabled={busy}
            >
              <RotateCcw className="mr-1 h-3 w-3" />
              Devolver
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setAssignOpen(true)}
              disabled={busy}
            >
              <UserCheck className="mr-1 h-3 w-3" />
              Asignar
            </Button>
          )}
        </div>

        {isAssigned ? (
          <div className="flex items-center gap-3">
            <PersonAvatar name={assignedToName} src={item.assignedTo?.avatarUrl} size="md" />
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-sm font-medium">{assignedToName}</span>
              <span className="text-xs text-[hsl(var(--muted-foreground))]">
                desde {formatDate(item.assignedAt)}
              </span>
            </div>
          </div>
        ) : (
          <p className="text-sm text-[hsl(var(--muted-foreground))]">Sin asignacion activa</p>
        )}

        {assignments.length > 0 && (
          <div>
            <p className="text-xs font-medium text-[hsl(var(--muted-foreground))] mb-2">Historial</p>
            <div>
              {assignments.map(r => (
                <AssignmentHistoryRow key={r.id} record={r} />
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* Assign sheet */}
      <Sheet open={assignOpen} onOpenChange={setAssignOpen}>
        <SheetContent side="right" className="w-full sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Asignar activo</SheetTitle>
          </SheetHeader>
          <div className="py-6 space-y-4">
            <ComboboxField
              label="Empleado"
              options={employeeOptions}
              value={selectedEmployee}
              onChange={setSelectedEmployee}
              placeholder="Seleccionar empleado..."
              searchPlaceholder="Buscar empleado..."
            />
            <MarkdownField
              label="Notas (opcional)"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Motivo de la asignacion, condicion del equipo, acuerdos..."
              maxLength={2000}
            />
          </div>
          <SheetFooter>
            <Button variant="outline" onClick={() => setAssignOpen(false)} disabled={busy}>
              Cancelar
            </Button>
            <Button onClick={handleAssign} disabled={busy || !selectedEmployee}>
              {busy ? 'Asignando...' : 'Confirmar asignacion'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Return confirmation */}
      <ConfirmDialog
        open={returnOpen}
        onOpenChange={setReturnOpen}
        title="Registrar devolucion"
        description={`¿Confirmas que "${assignedToName}" devolvio este activo?`}
        confirmLabel="Confirmar devolucion"
        onConfirm={handleReturn}
        loading={returnItem.isPending}
      />
    </>
  )
}
