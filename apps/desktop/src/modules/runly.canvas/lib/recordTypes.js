import { Briefcase, Calendar, Car, CheckSquare, FileText, Landmark, Package, User, UserRound } from 'lucide-react'

// ERP records a board object can be linked to. `type` is the relation-target
// catalog key used for search; moduleKey/entityType are what the canvas API
// stores and resolves (see CANVAS_ENTITY_TARGETS in the API).
export const RECORD_TYPES = [
  { type: 'contact', moduleKey: 'runly.contacts', entityType: 'contact', label: 'Contacto', icon: User },
  { type: 'hr_employee', moduleKey: 'runly.hr', entityType: 'hr_employee', label: 'Empleado', icon: UserRound },
  { type: 'vehicle', moduleKey: 'runly.fleet', entityType: 'vehicle', label: 'Vehículo', icon: Car },
  { type: 'inventory_item', moduleKey: 'runly.inventory', entityType: 'inventory_item', label: 'Artículo de inventario', icon: Package },
  { type: 'project', moduleKey: 'runly.projects', entityType: 'project', label: 'Proyecto', icon: Briefcase },
  { type: 'task', moduleKey: 'runly.projects', entityType: 'task', label: 'Tarea', icon: CheckSquare },
  { type: 'calendar_event', moduleKey: 'runly.calendar', entityType: 'calendar_event', label: 'Evento', icon: Calendar },
  { type: 'ledger_account', moduleKey: 'runly.ledger', entityType: 'ledger_account', label: 'Cuenta', icon: Landmark },
  { type: 'file', moduleKey: 'runly.files', entityType: 'file', label: 'Archivo', icon: FileText },
]

export function recordTypeOf(link) {
  return RECORD_TYPES.find((item) => item.moduleKey === link.moduleKey && item.entityType === link.entityType)
    ?? RECORD_TYPES.find((item) => item.entityType === link.entityType)
}
