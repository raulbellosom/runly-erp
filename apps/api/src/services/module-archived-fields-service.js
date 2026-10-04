// Archived fields of an RME3 module (spec 2026-10-03-rme3-module-platform-v2
// §8.3): fields removed by an update keep their column and data, and their
// RunlyField row marked `removed_from_manifest`. Adding the field back
// restores it; "Eliminar definitivamente" drops the column after a backup.
import { createModuleBackupService } from './module-backup-service.js'

const IDENTIFIER_RE = /^[a-z_][a-z0-9_]*$/
const isArchived = (field) => field.validation?.reason === 'removed_from_manifest'

export function createModuleArchivedFieldsService({ prisma }) {
  const backups = createModuleBackupService({ prisma })

  async function existingColumns(table) {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`, table,
    )
    return new Set(rows.map((row) => row.column_name))
  }

  async function listArchivedFields(moduleKey) {
    const models = await prisma.runlyModel.findMany({
      where: { moduleKey },
      select: { name: true, tableName: true, schema: true, fields: { select: { name: true, label: true, type: true, validation: true } } },
    })
    const result = []
    for (const model of models) {
      const archived = model.fields.filter(isArchived)
      if (!archived.length || !IDENTIFIER_RE.test(model.tableName)) continue
      const columns = await existingColumns(model.tableName)
      for (const field of archived) {
        if (!columns.has(field.name) || !IDENTIFIER_RE.test(field.name)) continue
        const [{ count }] = await prisma.$queryRawUnsafe(`SELECT COUNT("${field.name}")::bigint AS count FROM "${model.tableName}"`)
        result.push({
          entity: model.schema?.key ?? model.name.split('.').pop(),
          table: model.tableName,
          field: field.name,
          label: field.label,
          type: field.type,
          rowsWithValue: Number(count),
        })
      }
    }
    return result
  }

  async function purgeArchivedField({ moduleKey, table, field, actorId = null }) {
    const archived = (await listArchivedFields(moduleKey)).find((item) => item.table === table && item.field === field)
    if (!archived) throw Object.assign(new Error('ARCHIVED_FIELD_NOT_FOUND'), { statusCode: 404 })
    return prisma.$transaction(async (tx) => {
      const backup = await backups.snapshotModuleTables(tx, { moduleKey, tables: [table], actorId })
      await tx.$executeRawUnsafe(`ALTER TABLE "${table}" DROP COLUMN "${field}"`)
      const model = await tx.runlyModel.findFirst({ where: { moduleKey, tableName: table }, select: { id: true } })
      if (model) await tx.runlyField.deleteMany({ where: { modelId: model.id, name: field } })
      if (tx.auditLog?.create) {
        await tx.auditLog.create({
          data: {
            actorId, moduleKey, entityType: 'RunlyField', entityId: model?.id ?? table,
            action: 'core.module.field.purged', before: JSON.stringify(archived), after: JSON.stringify({ backupId: backup?.id ?? null }), metadata: null,
          },
        })
      }
      return { purged: archived, backupId: backup?.id ?? null }
    }, { maxWait: 10_000, timeout: 120_000 })
  }

  return { listArchivedFields, purgeArchivedField }
}
