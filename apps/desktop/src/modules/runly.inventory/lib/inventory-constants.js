export const ITEM_STATUSES = [
  { value: 'available',   label: 'Disponible',    color: '#16a34a', bgColor: '#dcfce7' },
  { value: 'assigned',    label: 'Asignado',      color: '#2563eb', bgColor: '#dbeafe' },
  { value: 'maintenance', label: 'Mantenimiento', color: '#d97706', bgColor: '#fef3c7' },
  { value: 'retired',     label: 'Retirado',      color: '#6b7280', bgColor: '#f3f4f6' },
  { value: 'lost',        label: 'Perdido',       color: '#dc2626', bgColor: '#fee2e2' },
  { value: 'stolen',      label: 'Robado',        color: '#7c2d12', bgColor: '#fef2f2' },
  { value: 'disposed',    label: 'Desechado',     color: '#374151', bgColor: '#f9fafb' },
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
  { value: 'status',    label: 'Estado' },
  { value: 'location',  label: 'Ubicacion' },
  { value: 'assignee',  label: 'Responsable' },
]

export const VIEW_MODE_OPTIONS = [
  { value: 'tree',   label: 'Arbol' },
  { value: 'table',  label: 'Tabla' },
  { value: 'cards',  label: 'Tarjetas' },
]

export const INVENTORY_EMOJI_PALETTE = ['👍', '❤️', '😄', '😮', '🎯', '🔧', '✅', '❌']

export const ALLOWED_ITEM_STATUS_TRANSITIONS = {
  available:   ['assigned', 'maintenance', 'retired', 'lost', 'stolen', 'disposed'],
  assigned:    ['available', 'maintenance', 'retired', 'lost', 'stolen', 'disposed'],
  maintenance: ['available', 'retired', 'disposed'],
  retired:     ['disposed'],
  lost:        ['available'],
  stolen:      ['available'],
  disposed:    [],
}
