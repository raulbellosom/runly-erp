// Desactivados providers for Calendario, Flota, Documentos and Archivos (spec
// 2026-10-03-records-trash-design §5.4, "other modules join with the same
// contract"). Canvas (boards are deleted, not archived) and Compras (status
// workflow, no deactivation) have nothing to list.
import { TrashError, TrashInUseError, isForeignKeyViolation } from './trash-errors.js'
import { contains, prismaProvider } from './core-trash-providers.js'

const dateLabel = (value) => (value ? new Date(value).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }) : null)

export const MORE_TRASH_PROVIDERS = Object.freeze([
  prismaProvider({
    id: 'runly.calendar:event', moduleKey: 'runly.calendar', moduleName: 'Calendario',
    label: 'Evento', pluralLabel: 'Eventos', restorePermission: 'calendar.events.delete', delegate: 'calendarEvent',
    scope: (companyId) => ({ calendar: { companyId } }),
    select: { id: true, title: true, startAt: true, updatedAt: true },
    toLabel: (row) => [row.title, dateLabel(row.startAt)].filter(Boolean).join(' · '),
    searchWhere: (term) => ({ title: contains(term) }),
  }),
  prismaProvider({
    id: 'runly.fleet:vehicle', moduleKey: 'runly.fleet', moduleName: 'Flota',
    label: 'Vehículo', pluralLabel: 'Vehículos', restorePermission: 'fleet.vehicles.delete', delegate: 'fleetVehicle',
    select: { id: true, plate: true, brand: true, modelName: true, updatedAt: true },
    toLabel: (row) => [row.plate, [row.brand, row.modelName].filter(Boolean).join(' ')].filter(Boolean).join(' · '),
    searchWhere: (term) => ({ OR: [{ plate: contains(term) }, { brand: contains(term) }, { modelName: contains(term) }] }),
  }),
  prismaProvider({
    id: 'runly.fleet:driver', moduleKey: 'runly.fleet', moduleName: 'Flota',
    label: 'Conductor', pluralLabel: 'Conductores', restorePermission: 'fleet.drivers.delete', delegate: 'fleetDriver',
    select: { id: true, firstName: true, lastName: true, updatedAt: true },
    toLabel: (row) => `${row.firstName ?? ''} ${row.lastName ?? ''}`.trim(),
    searchWhere: (term) => ({ OR: [{ firstName: contains(term) }, { lastName: contains(term) }] }),
  }),
  prismaProvider({
    id: 'runly.documents:template', moduleKey: 'runly.documents', moduleName: 'Documentos',
    label: 'Plantilla', pluralLabel: 'Plantillas', restorePermission: 'documents.templates.delete', delegate: 'documentTemplate',
    select: { id: true, name: true, updatedAt: true },
    toLabel: (row) => row.name,
    searchWhere: (term) => ({ name: contains(term) }),
  }),
  prismaProvider({
    id: 'runly.documents:generated', moduleKey: 'runly.documents', moduleName: 'Documentos',
    label: 'Documento generado', pluralLabel: 'Documentos generados', restorePermission: 'documents.generated.delete', delegate: 'generatedDocument',
    select: { id: true, createdAt: true, updatedAt: true, template: { select: { name: true } } },
    toLabel: (row) => [row.template?.name ?? 'Documento', dateLabel(row.createdAt)].filter(Boolean).join(' · '),
    searchWhere: (term) => ({ template: { name: contains(term) } }),
  }),
])

// Archivos goes through files-service: it enforces restricted-file access and
// removes the stored object on purge (Office files keep their recovery history,
// so files-service only disables them; they cannot be purged from here).
export function createFilesTrashProvider({ filesService }) {
  if (!filesService) return null
  const call = (ctx, extra) => ({ authUserId: ctx.authUserId, activeContext: ctx.activeContext, ...extra })
  return {
    id: 'runly.files:file', moduleKey: 'runly.files', moduleName: 'Archivos',
    label: 'Archivo', pluralLabel: 'Archivos',
    permissions: { restore: 'files.assets.update', purge: 'files.assets.delete' },
    async count(ctx) {
      return (await filesService.list(call(ctx, { query: { enabled: 'false', page: 1, pageSize: 1 } }))).pagination?.total ?? 0
    },
    async list(ctx, { search = '', page = 1 } = {}) {
      const result = await filesService.list(call(ctx, { query: { enabled: 'false', q: search, page, pageSize: 25, sortBy: 'updatedAt' } }))
      return { items: (result.data ?? []).map((file) => ({ id: file.id, label: file.originalName, deactivatedAt: file.updatedAt })), total: result.pagination?.total ?? 0 }
    },
    async restore(ctx, id) {
      const file = await filesService.setEnabled(call(ctx, { id, enabled: true }))
      return { id: file.id, label: file.originalName }
    },
    async purge(ctx, id) {
      const before = await ctx.prisma.fileAsset.findUnique({ where: { id }, select: { id: true, originalName: true, enabled: true } })
      if (!before || before.enabled) throw new TrashError('El archivo no está desactivado o no existe.', 404)
      try {
        await filesService.delete(call(ctx, { id }))
      } catch (error) {
        if (isForeignKeyViolation(error)) throw new TrashInUseError('está adjunto a otros registros')
        throw error
      }
      if (await ctx.prisma.fileAsset.findUnique({ where: { id }, select: { id: true } })) {
        throw new TrashError('Los documentos de Office conservan su historial de versiones y no se pueden eliminar definitivamente.', 409, 'office_history')
      }
      return { id, label: before.originalName }
    },
  }
}
