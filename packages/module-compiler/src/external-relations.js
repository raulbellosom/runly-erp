// Entities of other (system) modules a Builder module can relate to. The API
// implements search/resolution for each type (services/relation-targets) on
// top of the chat entity-reference resolvers, so permissions and company
// scoping are the owning module's own.
// See docs/superpowers/specs/2026-09-28-rme3-builder-external-relations-design.md.
export const EXTERNAL_RELATION_TARGETS = Object.freeze({
  contact: { label: 'Contacto', pluralLabel: 'Contactos', module: 'runly.contacts', moduleName: 'Contactos', permission: 'contacts.contacts.read' },
  hr_employee: { label: 'Colaborador', pluralLabel: 'Colaboradores', module: 'runly.hr', moduleName: 'Recursos humanos', permission: 'hr.employee.read' },
  vehicle: { label: 'Vehículo', pluralLabel: 'Vehículos', module: 'runly.fleet', moduleName: 'Flotilla', permission: 'fleet.vehicles.read' },
  inventory_item: { label: 'Artículo de inventario', pluralLabel: 'Artículos de inventario', module: 'runly.inventory', moduleName: 'Inventario', permission: 'inventory.item.read' },
  project: { label: 'Proyecto', pluralLabel: 'Proyectos', module: 'runly.projects', moduleName: 'Proyectos', permission: 'projects.project.read' },
  task: { label: 'Tarea', pluralLabel: 'Tareas', module: 'runly.projects', moduleName: 'Proyectos', permission: 'projects.task.read' },
  calendar_event: { label: 'Evento de calendario', pluralLabel: 'Eventos', module: 'runly.calendar', moduleName: 'Calendario', permission: 'calendar.events.read' },
  ledger_account: { label: 'Cuenta', pluralLabel: 'Cuentas', module: 'runly.ledger', moduleName: 'Cuentas', permission: 'ledger.accounts.read' },
  file: { label: 'Archivo', pluralLabel: 'Archivos', module: 'runly.files', moduleName: 'Archivos', permission: 'files.assets.read' },
})

export function isExternalRelation(field) {
  return field?.type === 'relation' && Boolean(field.targetExternal)
}

export function externalTarget(type) {
  return Object.prototype.hasOwnProperty.call(EXTERNAL_RELATION_TARGETS, type) ? EXTERNAL_RELATION_TARGETS[type] : null
}

// Module keys a definition must depend on because of its external relations.
export function externalRelationDependencies(entities) {
  const keys = new Set()
  for (const entity of entities ?? []) {
    for (const field of entity.fields ?? []) {
      const target = isExternalRelation(field) ? externalTarget(field.targetExternal) : null
      if (target) keys.add(target.module)
    }
  }
  return [...keys]
}
