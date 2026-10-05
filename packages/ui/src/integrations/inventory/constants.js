export const ITEM_STATUSES = [
  // Disponibilidad: its own hues (teal, indigo, violet) so they never read as
  // the green/amber/red/blue of the alta/baja Estado.
  { value: 'available',   label: 'Disponible',    color: '#0d9488', bgColor: '#ccfbf1' },
  { value: 'assigned',    label: 'Asignado',      color: '#4f46e5', bgColor: '#e0e7ff' },
  { value: 'maintenance', label: 'Mantenimiento', color: '#9333ea', bgColor: '#f3e8ff' },
]
// Retirado / Perdido / Robado / Desechado became administrative bajas
// (see lib/admin-status.js).

// How the item was acquired (inv_item.acquisition_origin). Commercial data
// (orders, invoices, amounts) lives in Compras.
export const ACQUISITION_ORIGIN_OPTIONS = [
  { value: 'PURCHASE', label: 'Compra' },
  { value: 'DONATION', label: 'Donación' },
  { value: 'TRANSFER', label: 'Transferencia' },
  { value: 'LEASE', label: 'Arrendamiento' },
  { value: 'INTERNAL', label: 'Producción interna' },
  { value: 'INITIAL_STOCK', label: 'Inventario inicial' },
  { value: 'OTHER', label: 'Otro' },
]

export const ITEM_TYPES = [
  { value: 'hardware',    label: 'Hardware' },
  { value: 'software',    label: 'Software' },
  { value: 'license',     label: 'Licencia' },
  { value: 'equipment',   label: 'Equipo / Maquinaria' },
  { value: 'furniture',   label: 'Mobiliario' },
  { value: 'vehicle',     label: 'Vehiculo' },
  { value: 'consumable',  label: 'Consumible' },
  { value: 'other',       label: 'Otro' },
]

export const GROUP_BY_OPTIONS = [
  { value: 'category',  label: 'Tipo' },
  { value: 'brand',     label: 'Marca' },
  { value: 'status',    label: 'Disponibilidad' },
  { value: 'location',  label: 'Ubicacion' },
  { value: 'assignee',  label: 'Responsable' },
]

export const VIEW_MODE_OPTIONS = [
  { value: 'tree',   label: 'Arbol' },
  { value: 'table',  label: 'Tabla' },
  { value: 'cards',  label: 'Tarjetas' },
]

export const INVENTORY_EMOJI_PALETTE = ['👍', '❤️', '😄', '😮', '🎯', '🔧', '✅', '❌']

// Operational status only; `assigned` comes from assign/return and bajas
// from the administrative flow.
export const ALLOWED_ITEM_STATUS_TRANSITIONS = {
  available:   ['assigned', 'maintenance'],
  assigned:    ['available'],
  maintenance: ['available'],
}
