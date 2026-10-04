// Services core modules offer to other modules (spec
// 2026-10-03-rme3-module-platform-v2 §10.7, extended by
// 2026-10-04-module-services-v2-design). Labels, permissions, `mutates`,
// `scope` and the argument schema come from the shared contract
// (@runly/module-engine/contracts SERVICE_CONTRACTS); the gateway validates
// args against it before a handler runs, so handlers only ever receive
// declared, coerced fields. Handlers only see the active company and return
// plain, minimal objects (no internal columns).
//
// Deviation from the plan: inventory is asset-based (one row per asset, no
// stock), so `items.adjustStock` is not offered.
import { SERVICE_CONTRACTS } from '@runly/module-engine/contracts'
import { createInventoryService } from '../inventory-service.js'
import { createContactsService } from '../contacts-service.js'
import { createNotificationService } from '../notification-service.js'
import { createTasksService } from '../../routes/projects/tasks-service.js'
import { createCalendarService } from '../../routes/calendar/calendar-service.js'
import { createCalendarEventService } from '../../routes/calendar/calendar-event-service.js'

export class ModuleServiceError extends Error {
  constructor(message, status = 400, code = 'module_service_error') {
    super(message)
    this.status = status
    this.code = code
  }
}

const itemView = (item) => item && ({ id: item.id, name: item.name, assetTag: item.assetTag ?? null, status: item.status ?? null, enabled: item.enabled !== false })
const contactView = (contact) => contact && ({ id: contact.id, name: contact.name, type: contact.type ?? null, email: contact.email ?? contact.primaryEmail ?? null, phone: contact.phone ?? contact.primaryPhone ?? null })
const taskView = (task) => task && ({ id: task.id, projectId: task.projectId, title: task.title, taskNumber: task.taskNumber ?? null, statusId: task.statusId, dueDate: task.dueDate ?? null, completedAt: task.completedAt ?? null })
const eventView = (event) => event && ({ id: event.id, calendarId: event.calendarId, title: event.title, description: event.description ?? null, startAt: event.startAt, endAt: event.endAt ?? null, allDay: Boolean(event.allDay), location: event.location ?? null, sourceEntityId: event.sourceEntityId ?? null })
const fileView = (asset) => asset && ({ id: asset.id, name: asset.originalName, mimeType: asset.mimeType, sizeBytes: asset.sizeBytes, sourceEntityId: asset.metadata?.source?.sourceEntityId ?? null })

// Drops nulls for fields that cannot be cleared.
const withoutNull = (args, keys) => Object.fromEntries(Object.entries(args).filter(([key, value]) => !(keys.includes(key) && value === null)))
const notFound = (label) => new ModuleServiceError(`${label} no existe o no lo creó este módulo.`, 404, 'not_found')

export function createServiceCatalog({ prisma, filesService = null }) {
  const inventory = createInventoryService({ prisma, activityBridge: null })
  const contacts = createContactsService({ prisma })
  const tasks = createTasksService({ prisma })
  const calendars = createCalendarService({ prisma })
  const events = createCalendarEventService({ prisma })
  const notifications = createNotificationService({ prisma })

  async function companyTask(id, companyId) {
    const task = await prisma.task.findFirst({ where: { id, project: { companyId } }, select: { id: true, projectId: true } })
    if (!task) throw new ModuleServiceError('La tarea no existe en esta empresa.', 404, 'not_found')
    return task
  }
  // scope 'own': only events this module created; others answer 404.
  async function ownEvent(id, moduleKey) {
    const event = await prisma.calendarEvent.findFirst({ where: { id, sourceModule: moduleKey, enabled: true }, select: { id: true } })
    if (!event) throw notFound('El evento')
    return event
  }
  function requireFiles() {
    if (!filesService) throw new ModuleServiceError('El almacenamiento de archivos no está disponible en esta instancia.', 503, 'files_unavailable')
    return filesService
  }

  const handlers = {
    'runly.inventory:items.read': async ({ companyId }, { id }) => itemView(await inventory.getItem(id, companyId).catch(() => null)),
    'runly.inventory:items.search': async ({ companyId }, args) => {
      const result = await inventory.listItems({ companyId, search: args.search ?? '', limit: args.limit ?? 20 })
      return { items: (result.data ?? []).map(itemView), total: result.total }
    },
    'runly.inventory:items.update': async ({ companyId, actorAuthId }, { id, ...data }) => {
      await inventory.updateItem(id, withoutNull(data, ['name', 'status']), companyId, { actorAuthId })
      return itemView(await inventory.getItem(id, companyId))
    },
    'runly.contacts:contacts.read': async ({ companyId, actorAuthId }, { id }) => contactView(await contacts.getById({ authUserId: actorAuthId, companyId, id }).catch(() => null)),
    'runly.contacts:contacts.search': async ({ companyId, actorAuthId }, args) => {
      const result = await contacts.list({ authUserId: actorAuthId, companyId, search: args.search ?? '', pageSize: args.limit ?? 20 })
      return { items: (result.rows ?? []).map(contactView), total: result.total }
    },
    'runly.contacts:contacts.create': async ({ companyId, actorAuthId }, args) => {
      if ((args.name ?? '').length < 2) throw new ModuleServiceError('El nombre del contacto es obligatorio.', 400)
      const payload = { type: args.type ?? 'person', name: args.name, ...(args.email ? { email: args.email } : {}), ...(args.phone ? { phone: args.phone } : {}) }
      return contactView(await contacts.create({ authUserId: actorAuthId, companyId, payload }))
    },
    'runly.contacts:contacts.update': async ({ companyId, actorAuthId }, { id, ...payload }) => {
      const data = withoutNull(payload, ['name', 'type'])
      if (data.name !== undefined && data.name.length < 2) throw new ModuleServiceError('El nombre del contacto es obligatorio.', 400)
      return contactView(await contacts.update({ authUserId: actorAuthId, companyId, id, payload: data }))
    },
    'runly.projects:tasks.read': async ({ companyId, actorId }, { id }) => {
      const task = await prisma.task.findFirst({ where: { id, project: { companyId } }, select: { id: true, projectId: true } })
      if (!task) return null
      return taskView(await tasks.getTask(task.id, { projectId: task.projectId, companyId, actorId }).catch(() => null))
    },
    'runly.projects:tasks.create': async ({ companyId, actorId }, args) => {
      const project = await prisma.project.findFirst({ where: { id: args.projectId, companyId }, select: { id: true } })
      if (!project) throw new ModuleServiceError('El proyecto no existe en esta empresa.', 404)
      const status = await prisma.taskStatus.findFirst({ where: { projectId: project.id }, orderBy: { position: 'asc' }, select: { id: true } })
      if (!status) throw new ModuleServiceError('El proyecto no tiene estados de tarea.', 409)
      const task = await tasks.createTask(project.id, actorId, {
        title: args.title, description: args.description ?? undefined,
        statusId: status.id, dueDate: args.dueDate ?? undefined, assigneeId: args.assigneeId ?? undefined,
      })
      return taskView(task)
    },
    'runly.projects:tasks.update': async ({ companyId, actorId }, { id, ...data }) => {
      // updateTask itself is not company-scoped: check the project's company first.
      const task = await companyTask(id, companyId)
      await tasks.updateTask(task.id, withoutNull(data, ['title', 'statusId', 'priority']))
      return taskView(await tasks.getTask(task.id, { projectId: task.projectId, companyId, actorId }))
    },
    'runly.calendar:calendars.list': async ({ companyId, actorId }) => {
      const { owned, shared } = await calendars.listCalendars(actorId, companyId)
      const writable = [...owned, ...shared.filter((calendar) => ['EDITOR', 'MANAGER'].includes(calendar._sharedRole))]
      return writable.map((calendar) => ({ id: calendar.id, name: calendar.name, isDefault: Boolean(calendar.isDefault) }))
    },
    'runly.calendar:events.list': async ({ companyId, actorId, moduleKey }, args) => {
      const rows = await events.listEvents({ userId: actorId, companyId, start: args.from, end: args.to, sourceModule: moduleKey, sourceEntityId: args.sourceEntityId ?? undefined })
      return rows.map(eventView)
    },
    'runly.calendar:events.create': async ({ companyId, actorId, moduleKey }, args) => {
      const calendarId = args.calendarId ?? (await calendars.ensureDefaultCalendar(actorId, companyId)).id
      const event = await events.createEvent(actorId, { ...args, calendarId, sourceModule: moduleKey, sourceEntityId: args.sourceEntityId ?? null }, companyId)
      return eventView(event)
    },
    'runly.calendar:events.update': async ({ companyId, actorId, moduleKey }, { id, ...data }) => {
      await ownEvent(id, moduleKey)
      return eventView(await events.updateEvent(actorId, id, withoutNull(data, ['title', 'startAt', 'allDay']), companyId))
    },
    'runly.calendar:events.cancel': async ({ companyId, actorId, moduleKey }, { id }) => {
      await ownEvent(id, moduleKey)
      await events.deleteEvent(actorId, id, companyId)
      return { id, cancelled: true }
    },
    'runly.files:files.save': async ({ actorAuthId, activeContext, moduleKey }, args) => {
      const file = new File([Buffer.from(args.contentBase64, 'base64')], args.name, { type: args.mimeType })
      const asset = await requireFiles().upload({
        authUserId: actorAuthId,
        activeContext,
        file,
        fields: {
          moduleKey: 'runly.files',
          entityType: 'AtlasFile',
          shareWithCompany: args.shareWithCompany === true,
          metadata: { source: { moduleKey, sourceEntityId: args.sourceEntityId ?? null } },
        },
      })
      return fileView(asset)
    },
    'runly.files:files.signedUrl': async ({ companyId, actorAuthId, activeContext, moduleKey }, { id }) => {
      const owned = await prisma.fileAsset.findFirst({ where: { id, entityId: companyId, enabled: true, metadata: { path: ['source', 'moduleKey'], equals: moduleKey } }, select: { id: true } })
      if (!owned) throw notFound('El archivo')
      const { signedUrl, expiresIn } = await requireFiles().getSignedUrl({ authUserId: actorAuthId, activeContext, id })
      return { id, url: signedUrl, expiresIn: expiresIn ?? null }
    },
    'runly.notifications:notifications.send': async ({ companyId, actorId, moduleKey }, args) => {
      const result = await notifications.publish({
        companyId,
        actorId,
        input: {
          eventType: `module.${moduleKey}`,
          title: args.title,
          ...(args.body ? { body: args.body } : {}),
          ...(args.link ? { link: args.link } : {}),
          ...(args.priority ? { priority: args.priority } : {}),
          recipients: { userIds: args.userIds },
          sourceType: moduleKey,
          ...(args.sourceEntityId ? { sourceId: args.sourceEntityId } : {}),
        },
      })
      return { sent: result?.created ?? 0 }
    },
  }

  return Object.fromEntries(Object.entries(handlers).map(([key, handler]) => [key, { ...SERVICE_CONTRACTS[key], handler }]))
}

// Static metadata (labels, owning module) for consent dialogs and docs.
export { SERVICE_KEYS } from '@runly/module-engine/contracts'

export function splitServiceKey(serviceKey) {
  const [moduleKey, name] = String(serviceKey ?? '').split(':')
  return { moduleKey, name }
}
