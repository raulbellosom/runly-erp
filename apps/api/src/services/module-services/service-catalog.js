// Services core modules offer to other modules (spec
// 2026-10-03-rme3-module-platform-v2 §10.7, plan Task 6.1). Each entry: the
// Spanish label shown in the install consent, the permission the CALLING USER
// must hold, whether it writes, and a handler that only ever sees the active
// company. Results are plain, minimal objects (no internal columns).
//
// Deviation from the plan: inventory is asset-based (one row per asset, no
// stock), so `items.adjustStock` is not offered.
import { createInventoryService } from '../inventory-service.js'
import { createContactsService } from '../contacts-service.js'
import { createTasksService } from '../../routes/projects/tasks-service.js'

export class ModuleServiceError extends Error {
  constructor(message, status = 400, code = 'module_service_error') {
    super(message)
    this.status = status
    this.code = code
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const id = (value, label = 'id') => {
  if (!UUID.test(String(value ?? ''))) throw new ModuleServiceError(`${label} no válido.`, 400)
  return String(value)
}
const limitOf = (value) => Math.min(50, Math.max(1, Number.parseInt(value, 10) || 20))

const itemView = (item) => item && ({ id: item.id, name: item.name, assetTag: item.assetTag ?? null, status: item.status ?? null, enabled: item.enabled !== false })
const contactView = (contact) => contact && ({ id: contact.id, name: contact.name, type: contact.type ?? null, email: contact.email ?? contact.primaryEmail ?? null, phone: contact.phone ?? contact.primaryPhone ?? null })
const taskView = (task) => task && ({ id: task.id, projectId: task.projectId, title: task.title, taskNumber: task.taskNumber ?? null, statusId: task.statusId, dueDate: task.dueDate ?? null, completedAt: task.completedAt ?? null })

export function createServiceCatalog({ prisma }) {
  const inventory = createInventoryService({ prisma, activityBridge: null })
  const contacts = createContactsService({ prisma })
  const tasks = createTasksService({ prisma })

  const services = {
    'runly.inventory:items.read': {
      label: 'Leer artículos de inventario', permission: 'inventory.item.read', mutates: false,
      handler: async ({ companyId }, args) => itemView(await inventory.getItem(id(args?.id), companyId).catch(() => null)),
    },
    'runly.inventory:items.search': {
      label: 'Buscar artículos de inventario', permission: 'inventory.item.read', mutates: false,
      handler: async ({ companyId }, args) => {
        const result = await inventory.listItems({ companyId, search: String(args?.search ?? '').slice(0, 120), limit: limitOf(args?.limit) })
        return { items: (result.data ?? []).map(itemView), total: result.total }
      },
    },
    'runly.contacts:contacts.read': {
      label: 'Leer contactos', permission: 'contacts.contacts.read', mutates: false,
      handler: async ({ companyId, actorAuthId }, args) => contactView(await contacts.getById({ authUserId: actorAuthId, companyId, id: id(args?.id) }).catch(() => null)),
    },
    'runly.contacts:contacts.search': {
      label: 'Buscar contactos', permission: 'contacts.contacts.read', mutates: false,
      handler: async ({ companyId, actorAuthId }, args) => {
        const result = await contacts.list({ authUserId: actorAuthId, companyId, search: String(args?.search ?? '').slice(0, 120), pageSize: limitOf(args?.limit) })
        return { items: (result.rows ?? []).map(contactView), total: result.total }
      },
    },
    'runly.contacts:contacts.create': {
      label: 'Crear contactos', permission: 'contacts.contacts.create', mutates: true,
      handler: async ({ companyId, actorAuthId }, args) => {
        const name = String(args?.name ?? '').trim()
        if (name.length < 2) throw new ModuleServiceError('El nombre del contacto es obligatorio.', 400)
        const type = ['customer', 'supplier', 'person', 'company'].includes(args?.type) ? args.type : 'person'
        const payload = { type, name, ...(args?.email ? { email: String(args.email) } : {}), ...(args?.phone ? { phone: String(args.phone) } : {}) }
        return contactView(await contacts.create({ authUserId: actorAuthId, companyId, payload }))
      },
    },
    'runly.projects:tasks.read': {
      label: 'Leer tareas de proyectos', permission: 'projects.task.read', mutates: false,
      handler: async ({ companyId, actorId }, args) => {
        const task = await prisma.task.findFirst({ where: { id: id(args?.id), project: { companyId } }, select: { id: true, projectId: true } })
        if (!task) return null
        return taskView(await tasks.getTask(task.id, { projectId: task.projectId, companyId, actorId }).catch(() => null))
      },
    },
    'runly.projects:tasks.create': {
      label: 'Crear tareas en proyectos', permission: 'projects.task.create', mutates: true,
      handler: async ({ companyId, actorId }, args) => {
        const project = await prisma.project.findFirst({ where: { id: id(args?.projectId, 'Proyecto'), companyId }, select: { id: true } })
        if (!project) throw new ModuleServiceError('El proyecto no existe en esta empresa.', 404)
        const status = await prisma.taskStatus.findFirst({ where: { projectId: project.id }, orderBy: { position: 'asc' }, select: { id: true } })
        if (!status) throw new ModuleServiceError('El proyecto no tiene estados de tarea.', 409)
        const task = await tasks.createTask(project.id, actorId, {
          title: String(args?.title ?? ''), description: args?.description ? String(args.description) : undefined,
          statusId: status.id, dueDate: args?.dueDate ?? undefined, assigneeId: args?.assigneeId ?? undefined,
        })
        return taskView(task)
      },
    },
  }
  return services
}

// Static metadata (labels, owning module) for consent dialogs and docs.
export { SERVICE_KEYS } from '@runly/module-engine/contracts'

export function splitServiceKey(serviceKey) {
  const [moduleKey, name] = String(serviceKey ?? '').split(':')
  return { moduleKey, name }
}
