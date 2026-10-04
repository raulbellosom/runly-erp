// "Conexiones" screen of a core module (spec 2026-10-03-rme3-module-platform-v2
// §8.2): every connection declared to a target type for the company (pending,
// active, disabled), with what the module offers and the admin's choices.
import { normalizeConnection } from '@runly/module-engine'
import { createConnectionLifecycle, reconcileFieldConfig } from './connection-lifecycle.js'

export class ConnectionAdminError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

const SURFACES = ['form', 'detail', 'column', 'search']

export function createConnectionAdminService({ prisma }) {
  const lifecycle = createConnectionLifecycle({ prisma })
  async function listForAdmin({ companyId, targetType }) {
    await lifecycle.ensureCompanyConnections({ companyId })
    const rows = await prisma.moduleConnection.findMany({
      where: { companyId, targetType },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    })
    if (!rows.length) return []
    const keys = [...new Set(rows.map((row) => row.moduleKey))]
    const [modules, models] = await Promise.all([
      prisma.runlyModule.findMany({ where: { key: { in: keys } }, select: { key: true, name: true, status: true, enabled: true, manifest: true } }),
      prisma.runlyModel.findMany({ where: { moduleKey: { in: keys } }, select: { moduleKey: true, schema: true } }),
    ])
    return rows.map((row) => {
      const mod = modules.find((m) => m.key === row.moduleKey)
      const declaration = (mod?.manifest?.connections ?? []).find((c) => c.key === row.connectionKey)
      const model = models.find((m) => m.moduleKey === row.moduleKey && m.schema?.key === row.sourceEntity)?.schema
      const fieldDefs = new Map((model?.fields ?? []).map((field) => [field.name, field]))
      const offered = declaration ? normalizeConnection(declaration).fields : []
      return {
        id: row.id,
        moduleKey: row.moduleKey,
        moduleName: mod?.name ?? row.moduleKey,
        moduleIcon: mod?.manifest?.icon ?? null,
        moduleAvailable: mod?.status === 'INSTALLED' && mod?.enabled === true,
        connectionKey: row.connectionKey,
        label: declaration?.label ?? row.connectionKey,
        kind: row.kind,
        status: row.status,
        sortOrder: row.sortOrder,
        needsReview: row.needsReview,
        onTargetDelete: row.kind === 'fields' ? 'cascade' : (declaration?.onTargetDelete ?? 'setNull'),
        offered: offered.map((field) => ({ ...field, label: fieldDefs.get(field.field)?.label ?? field.field, type: fieldDefs.get(field.field)?.type ?? 'text' })),
        fieldConfig: row.fieldConfig,
      }
    })
  }

  // patch: { status?, fieldConfig?, sortOrder? }. fieldConfig is narrowed to
  // what the module offers (an admin can never expose a non-offered field).
  async function updateConfig({ companyId, id, patch }) {
    const row = await prisma.moduleConnection.findFirst({ where: { id, companyId } })
    if (!row) throw new ConnectionAdminError('Conexión no encontrada.', 404)
    const data = {}
    if (patch.status !== undefined) {
      if (!['active', 'disabled'].includes(patch.status)) throw new ConnectionAdminError('Estado inválido.', 400)
      data.status = patch.status
    }
    if (patch.sortOrder !== undefined) data.sortOrder = Number.parseInt(patch.sortOrder, 10) || 0
    if (patch.fieldConfig !== undefined) {
      const mod = await prisma.runlyModule.findUnique({ where: { key: row.moduleKey }, select: { manifest: true } })
      const declaration = (mod?.manifest?.connections ?? []).find((c) => c.key === row.connectionKey)
      if (!declaration) throw new ConnectionAdminError('El módulo ya no declara esta conexión.', 409)
      const requested = (Array.isArray(patch.fieldConfig) ? patch.fieldConfig : []).map((entry, order) => {
        const clean = { field: String(entry?.field ?? ''), order: Number.isFinite(entry?.order) ? entry.order : order }
        for (const surface of SURFACES) clean[surface] = entry?.[surface] === true
        return clean
      })
      const { fieldConfig } = reconcileFieldConfig(requested, normalizeConnection(declaration))
      data.fieldConfig = fieldConfig
      data.needsReview = false
    }
    return prisma.moduleConnection.update({ where: { id }, data })
  }

  return { listForAdmin, updateConfig }
}
