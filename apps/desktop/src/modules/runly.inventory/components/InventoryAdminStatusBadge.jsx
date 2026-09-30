import { ADMIN_STATUS_BY_VALUE } from '../lib/admin-status.js'

// Administrative status pill (Alta, Pendiente de alta, Propuesta de baja, Baja).
export function InventoryAdminStatusBadge({ status, size = 'sm' }) {
  const config = ADMIN_STATUS_BY_VALUE[status]
  if (!config) return null
  const sizeClasses = size === 'sm' ? 'text-xs px-2 py-0.5' : 'text-sm px-2.5 py-1'
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-medium ${sizeClasses}`}
      style={{ color: config.color, backgroundColor: `${config.color}1f` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: config.color }} />
      {config.label}
    </span>
  )
}
