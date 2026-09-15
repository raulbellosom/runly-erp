import { useNavigate } from 'react-router-dom'
import { EmptyState, LoadingState } from '@runly/ui'
import { Boxes } from 'lucide-react'
import { useInventoryItemsByEmployee } from '../hooks/useInventoryItems.js'
import { InventoryStatusBadge } from './InventoryStatusBadge.jsx'

// No own card/header chrome — this widget's sole caller,
// runly.hr's AssignedEquipmentSection (a RunlyDetail "component" section),
// already gets a card + "Equipos asignados" header from the blueprint's
// label/icon via RunlyDetail's section wrapper.
export function InventoryEmployeeWidget({ employeeId }) {
  const navigate = useNavigate()
  const { data, isLoading } = useInventoryItemsByEmployee(employeeId)
  const items = data?.data ?? data ?? []

  return (
    <div className="space-y-3">
      {items.length > 0 && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => navigate(`/app/m/runly.inventory/assignments?employee=${employeeId}`)}
            className="text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
          >
            Ver todos
          </button>
        </div>
      )}

      {isLoading ? (
        <LoadingState />
      ) : items.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title="Sin equipos asignados"
          description="Este empleado no tiene activos asignados"
        />
      ) : (
        <div className="space-y-1.5">
          {items.map(item => (
            <button
              key={item.id}
              type="button"
              onClick={() => navigate(`/app/m/runly.inventory/inventory/${item.id}`)}
              className="w-full flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-[hsl(var(--muted))] transition-colors"
            >
              <Boxes className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" />
              <span className="font-mono text-xs text-[hsl(var(--muted-foreground))] shrink-0">
                {item.assetTag}
              </span>
              <span className="flex-1 min-w-0 truncate">{item.name}</span>
              <InventoryStatusBadge status={item.status} size="sm" />
            </button>
          ))}
          {items.length >= 5 && (
            <button
              type="button"
              onClick={() => navigate(`/app/m/runly.inventory/assignments?employee=${employeeId}`)}
              className="w-full text-center text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] pt-1 transition-colors"
            >
              Ver historial completo
            </button>
          )}
        </div>
      )}
    </div>
  )
}
