// apps/api/src/routes/canvas/canvas-data-sources.js
//
// Sources a Canvas object can be bound to (`properties.binding`). Inventory
// locations and items have their own providers with live metrics; every other
// relation-target type (vehicles, employees, projects…) resolves through
// relation-targets-service with title/subtitle/url only.
import { EXTERNAL_RELATION_TARGETS } from '@runly/module-compiler'
import { createUserAccessService } from '../../services/user-access-service.js'

const INVENTORY = { module: 'runly.inventory', permission: 'inventory.item.read' }
export const DATA_SOURCES = Object.freeze({
  inventory_location: { label: 'Ubicación de inventario', ...INVENTORY },
  inventory_item: { label: 'Artículo de inventario', ...INVENTORY },
  pos_table: { label: 'Mesa de POS', module: 'runly.pos', permission: 'pos.floor.read' },
  ...Object.fromEntries(Object.entries(EXTERNAL_RELATION_TARGETS)
    .filter(([type]) => type !== 'inventory_item')
    .map(([type, target]) => [type, { label: target.label, module: target.module, permission: target.permission }])),
})
export const isDataSource = (key) => Object.hasOwn(DATA_SOURCES, key)
export const MAX_REFS = 500

const STATUS_LABELS = { available: 'Disponible', assigned: 'Asignado', maintenance: 'Mantenimiento' }
const STATUS_TONES = { available: 'ok', assigned: 'info', maintenance: 'warning' }
const POS_STATUS = {
  AVAILABLE: { label: 'Disponible', tone: 'ok' },
  RESERVED: { label: 'Reservada', tone: 'info' },
  OCCUPIED: { label: 'Ocupada', tone: 'warning' },
  BILL_REQUESTED: { label: 'Cuenta pedida', tone: 'danger' },
  DIRTY: { label: 'Sucia', tone: 'neutral' },
  DISABLED: { label: 'No disponible', tone: 'neutral' },
}
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`

export function createCanvasDataSources({ prisma, relationTargets, access = createUserAccessService({ prisma }) }) {
  async function profileIdOf(authUserId) {
    const profile = await prisma.userProfile.findUnique({ where: { authUserId }, select: { id: true } })
    return profile?.id ?? null
  }
  async function allowed(companyId, profileId, source) {
    if (!profileId) return false
    try { await access.assertCompanyMember(companyId, profileId, DATA_SOURCES[source].permission); return true } catch { return false }
  }

  async function catalog({ authUserId, companyId }) {
    const installed = new Set((await prisma.runlyModule.findMany({ where: { status: 'INSTALLED', enabled: true }, select: { key: true } })).map((row) => row.key))
    const profileId = await profileIdOf(authUserId)
    return Promise.all(Object.entries(DATA_SOURCES).map(async ([key, source]) => ({
      key, label: source.label, module: source.module,
      installed: installed.has(source.module), allowed: await allowed(companyId, profileId, key),
    })))
  }

  const providers = {
    async inventory_location(companyId, ids) {
      const locations = await prisma.invLocation.findMany({ where: { companyId, id: { in: ids }, enabled: true }, select: { id: true, name: true, description: true } })
      const counts = await prisma.invItem.groupBy({ by: ['locationId', 'status'], where: { companyId, enabled: true, adminStatus: 'registered', locationId: { in: locations.map((row) => row.id) } }, _count: { _all: true } })
      return new Map(locations.map((location) => {
        const byStatus = Object.fromEntries(counts.filter((row) => row.locationId === location.id).map((row) => [row.status, row._count._all]))
        const total = Object.values(byStatus).reduce((sum, value) => sum + value, 0), maintenance = byStatus.maintenance ?? 0
        return [location.id, {
          title: location.name, subtitle: location.description ?? null,
          summary: maintenance ? `${plural(total, 'equipo', 'equipos')} · ${maintenance} en mantenimiento` : plural(total, 'equipo', 'equipos'),
          tone: maintenance ? 'warning' : total ? 'ok' : 'neutral',
          metrics: [
            { label: 'Total', value: String(total) },
            { label: 'Disponibles', value: String(byStatus.available ?? 0) },
            { label: 'Asignados', value: String(byStatus.assigned ?? 0) },
            { label: 'En mantenimiento', value: String(maintenance) },
          ],
          url: '/app/m/runly.inventory',
        }]
      }))
    },
    async inventory_item(companyId, ids) {
      const items = await prisma.invItem.findMany({
        where: { companyId, id: { in: ids }, enabled: true },
        select: { id: true, name: true, assetTag: true, status: true, adminStatus: true, assignedTo: { select: { firstName: true, lastName: true } }, location: { select: { name: true } }, condition: { select: { name: true } } },
      })
      return new Map(items.map((item) => {
        const retired = item.adminStatus && item.adminStatus !== 'registered'
        const assignee = item.assignedTo ? `${item.assignedTo.firstName} ${item.assignedTo.lastName}`.trim() : null
        const status = STATUS_LABELS[item.status] ?? item.status
        return [item.id, {
          title: item.name, subtitle: item.assetTag ?? null,
          summary: retired ? 'Dado de baja' : assignee ? `${status} · ${assignee}` : status,
          tone: retired ? 'danger' : STATUS_TONES[item.status] ?? 'neutral',
          metrics: [
            { label: 'Estado', value: retired ? 'Dado de baja' : status },
            ...(assignee ? [{ label: 'Asignado a', value: assignee }] : []),
            ...(item.location?.name ? [{ label: 'Ubicación', value: item.location.name }] : []),
            ...(item.condition?.name ? [{ label: 'Condición', value: item.condition.name }] : []),
          ],
          url: `/app/m/runly.inventory/inventory/${item.id}`,
        }]
      }))
    },
    async pos_table(companyId, ids) {
      const rows = await prisma.posTable.findMany({ where: { companyId, id: { in: ids }, enabled: true }, select: { id: true, name: true, status: true, capacity: true, zone: { select: { name: true } }, floor: { select: { name: true } } } })
      return new Map(rows.map((row) => {
        const status = POS_STATUS[row.status] ?? { label: row.status, tone: 'neutral' }
        return [row.id, {
          title: row.name, subtitle: [row.zone?.name, row.floor?.name].filter(Boolean).join(' · ') || null,
          summary: `${status.label} · ${plural(row.capacity, 'persona', 'personas')}`, tone: status.tone,
          metrics: [{ label: 'Estado', value: status.label }, { label: 'Capacidad', value: String(row.capacity) }],
          url: '/app/m/runly.pos',
        }]
      }))
    },
  }

  // refs: [{ source, id }] -> { 'source:id': Resolution }
  async function resolve({ authUserId, companyId, refs }) {
    const bySource = new Map()
    for (const ref of (refs ?? []).slice(0, MAX_REFS)) {
      if (!ref || !isDataSource(ref.source) || typeof ref.id !== 'string') continue
      if (!bySource.has(ref.source)) bySource.set(ref.source, new Set())
      bySource.get(ref.source).add(ref.id)
    }
    const profileId = await profileIdOf(authUserId)
    const out = {}
    await Promise.all([...bySource].map(async ([source, idSet]) => {
      const ids = [...idSet]
      if (!(await allowed(companyId, profileId, source))) {
        for (const id of ids) out[`${source}:${id}`] = { title: 'Sin acceso', tone: 'neutral', restricted: true }
        return
      }
      let found
      try {
        found = providers[source]
          ? await providers[source](companyId, ids)
          : new Map([...(await relationTargets.resolve({ authUserId, companyId, type: source, ids }))].map(([id, row]) => [id, { ...row, tone: 'neutral' }]))
      } catch { found = new Map() }
      for (const id of ids) out[`${source}:${id}`] = found.get(id) ?? { title: 'Registro no disponible', tone: 'danger', missing: true }
    }))
    return out
  }

  async function search({ authUserId, companyId, source, q = '' }) {
    if (!isDataSource(source)) throw Object.assign(new Error('Fuente de datos desconocida.'), { status: 404 })
    const profileId = await profileIdOf(authUserId)
    if (!(await allowed(companyId, profileId, source))) throw Object.assign(new Error('No tienes permiso para ver esta fuente de datos.'), { status: 403 })
    if (source === 'inventory_location') {
      const query = String(q ?? '').trim().slice(0, 100)
      const rows = await prisma.invLocation.findMany({
        where: { companyId, enabled: true, ...(query ? { name: { contains: query, mode: 'insensitive' } } : {}) },
        select: { id: true, name: true, address: true }, orderBy: { name: 'asc' }, take: 20,
      })
      return rows.map((row) => ({ id: row.id, title: row.name, subtitle: row.address ?? null }))
    }
    if (source === 'pos_table') {
      const query = String(q ?? '').trim().slice(0, 100)
      const rows = await prisma.posTable.findMany({
        where: { companyId, enabled: true, ...(query ? { name: { contains: query, mode: 'insensitive' } } : {}) },
        select: { id: true, name: true, floor: { select: { name: true } } }, orderBy: { name: 'asc' }, take: 20,
      })
      return rows.map((row) => ({ id: row.id, title: row.name, subtitle: row.floor?.name ?? null }))
    }
    return relationTargets.search({ authUserId, companyId, type: source, q, limit: 20 })
  }

  return { catalog, resolve, search }
}
