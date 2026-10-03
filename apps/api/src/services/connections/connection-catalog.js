// Shared loading for connection reads and writes (spec
// 2026-10-03-rme3-module-platform-v2 §12.2): the active connections of a
// company for a core entity type, joined with their module, model and the
// admin's field config, filtered by what the user may see.

// Permission keys the Builder generates per entity: <slug>.<entity>.<action>.
export function entityPermission(moduleKey, entity, action) {
  return `${String(moduleKey).split('.').pop()}.${entity}.${action}`
}

export function can(user, permission) {
  return Boolean(user?.isAdmin || user?.permissionSet?.has?.(permission))
}

// Field definitions (label/type/options/required) of the offered fields that
// the admin enabled for `surface`, in configured order.
export function surfaceFields(connection, surface) {
  const modelFields = new Map((connection.model?.fields ?? []).map((field) => [field.name, field]))
  return (Array.isArray(connection.fieldConfig) ? connection.fieldConfig : [])
    .filter((entry) => entry[surface] && modelFields.has(entry.field))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((entry) => {
      const field = modelFields.get(entry.field)
      return { name: field.name, label: field.label ?? field.name, type: field.type, required: Boolean(field.required), options: field.options ?? null }
    })
}

export function createConnectionCatalog({ prisma }) {
  // Active connections of the company for the target type, whose module is
  // installed, enabled globally and for the company, and whose entity the
  // user can read. Each item carries its manifest declaration and model.
  async function activeConnections({ companyId, targetType, user, includeHidden = false }) {
    const rows = await prisma.moduleConnection.findMany({
      where: { companyId, targetType, status: 'active' },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    })
    if (!rows.length) return []
    const moduleKeys = [...new Set(rows.map((row) => row.moduleKey))]
    const [modules, disabledForCompany, models] = await Promise.all([
      prisma.runlyModule.findMany({
        where: { key: { in: moduleKeys }, status: 'INSTALLED', enabled: true },
        select: { id: true, key: true, name: true, manifest: true },
      }),
      prisma.companyModule.findMany({ where: { companyId, enabled: false }, select: { moduleId: true } }),
      prisma.runlyModel.findMany({ where: { moduleKey: { in: moduleKeys } }, select: { moduleKey: true, schema: true } }),
    ])
    const off = new Set(disabledForCompany.map((row) => row.moduleId))
    const moduleByKey = new Map(modules.filter((mod) => !off.has(mod.id)).map((mod) => [mod.key, mod]))
    const out = []
    for (const row of rows) {
      const mod = moduleByKey.get(row.moduleKey)
      if (!mod) continue
      const declaration = (mod.manifest?.connections ?? []).find((entry) => entry.key === row.connectionKey)
      const model = models.find((m) => m.moduleKey === row.moduleKey && m.schema?.key === row.sourceEntity)?.schema
      if (!declaration || !model) continue
      const readable = can(user, entityPermission(row.moduleKey, row.sourceEntity, 'read'))
      if (!readable && !includeHidden) continue
      out.push({
        ...row,
        moduleName: mod.name,
        moduleIcon: mod.manifest?.icon ?? null,
        label: declaration.label ?? mod.name,
        targetField: declaration.targetField,
        onTargetDelete: declaration.kind === 'fields' ? 'cascade' : (declaration.onTargetDelete ?? 'setNull'),
        model,
        readable,
      })
    }
    return out
  }

  return { activeConnections }
}
