// Entities of other (system) modules a Builder module can relate to. The API
// implements search/resolution for each type (services/relation-targets) on
// top of the chat entity-reference resolvers, so permissions and company
// scoping are the owning module's own.
// See docs/superpowers/specs/2026-09-28-rme3-builder-external-relations-design.md.
export const EXTERNAL_RELATION_TARGETS = Object.freeze({
  contact: { label: 'Contacto', pluralLabel: 'Contactos', module: 'runly.contacts', moduleName: 'Contactos', permission: 'contacts.contacts.read', connection: { table: 'contact', softDelete: 'enabled', recordContextTypes: ['contact'] } },
  hr_employee: { label: 'Colaborador', pluralLabel: 'Colaboradores', module: 'runly.hr', moduleName: 'Recursos humanos', permission: 'hr.employee.read', connection: { table: 'hr_employee', softDelete: 'enabled', recordContextTypes: ['employee','hr_employee'] } },
  vehicle: { label: 'Vehículo', pluralLabel: 'Vehículos', module: 'runly.fleet', moduleName: 'Flotilla', permission: 'fleet.vehicles.read', connection: { table: 'fleet_vehicle', softDelete: 'enabled', recordContextTypes: ['vehicle'] } },
  inventory_item: { label: 'Artículo de inventario', pluralLabel: 'Artículos de inventario', module: 'runly.inventory', moduleName: 'Inventario', permission: 'inventory.item.read', connection: { table: 'inv_item', softDelete: 'enabled', recordContextTypes: ['item','inventory_item'] } },
  project: { label: 'Proyecto', pluralLabel: 'Proyectos', module: 'runly.projects', moduleName: 'Proyectos', permission: 'projects.project.read', connection: { table: 'project', softDelete: null, recordContextTypes: ['project'] } },
  task: { label: 'Tarea', pluralLabel: 'Tareas', module: 'runly.projects', moduleName: 'Proyectos', permission: 'projects.task.read', connection: { table: 'task', softDelete: null, recordContextTypes: ['task'] } },
  calendar_event: { label: 'Evento de calendario', pluralLabel: 'Eventos', module: 'runly.calendar', moduleName: 'Calendario', permission: 'calendar.events.read', connection: { table: 'calendar_event', softDelete: 'enabled', recordContextTypes: ['event','calendar_event'] } },
  ledger_account: { label: 'Cuenta', pluralLabel: 'Cuentas', module: 'runly.ledger', moduleName: 'Cuentas', permission: 'ledger.accounts.read', connection: { table: 'ledger_account', softDelete: 'enabled', recordContextTypes: ['account','ledger_account'] } },
  file: { label: 'Archivo', pluralLabel: 'Archivos', module: 'runly.files', moduleName: 'Archivos', permission: 'files.assets.read', connection: { table: 'file_asset', softDelete: 'enabled', recordContextTypes: ['file'] } },
})

// Connections (spec 2026-10-03-rme3-module-platform-v2 §10.5): physical table
// of each target (FK target), its soft-delete column, and the recordType
// aliases its screens publish through useMiraiRecordContext.
export function connectionTarget(type) {
  const target = externalTarget(type)
  return target?.connection ? { type, ...target, ...target.connection } : null
}

export function targetTypeFromRecordContext(recordType) {
  const value = String(recordType ?? '')
  return Object.keys(EXTERNAL_RELATION_TARGETS).find((type) => EXTERNAL_RELATION_TARGETS[type].connection?.recordContextTypes?.includes(value)) ?? null
}

// `<slug>.connections.manage` of the target's owning module (runly.inventory -> inventory).
export function connectionsManagePermission(type) {
  const target = externalTarget(type)
  return target ? `${target.module.split('.').pop()}.connections.manage` : null
}

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
