// Desactivados providers of core modules (spec 2026-10-03-records-trash-design
// §5.4): inventory items, contacts and HR employees. Same contract as the
// generic RME3 provider; Prisma FK errors (P2003, including Connections
// "Impedir la eliminación") become TrashInUseError.
import { TrashError, TrashInUseError, isForeignKeyViolation } from './trash-errors.js'

const PAGE_SIZE = 25

// scope: where-fragment that ties a row to the company (default: its own companyId column).
export function prismaProvider({ id, moduleKey, moduleName, label, pluralLabel, restorePermission, purgePermission = null, delegate, toLabel, searchWhere, select, scope = (companyId) => ({ companyId }) }) {
  const where = (companyId, extra = {}) => ({ ...scope(companyId), enabled: false, ...extra })
  const find = async (prisma, companyId, recordId) => {
    const row = await prisma[delegate].findFirst({ where: where(companyId, { id: recordId }), select })
    if (!row) throw new TrashError('El registro no está desactivado o no existe.', 404)
    return row
  }
  return {
    id, moduleKey, moduleName, label, pluralLabel,
    permissions: { restore: restorePermission, purge: purgePermission },
    count: ({ prisma, companyId }) => prisma[delegate].count({ where: where(companyId) }),
    async list({ prisma, companyId }, { search = '', page = 1 } = {}) {
      const term = String(search ?? '').trim()
      const filter = where(companyId, term ? searchWhere(term) : {})
      const [rows, total] = await Promise.all([
        prisma[delegate].findMany({ where: filter, select, orderBy: { updatedAt: 'desc' }, take: PAGE_SIZE, skip: (Math.max(1, Number(page) || 1) - 1) * PAGE_SIZE }),
        prisma[delegate].count({ where: filter }),
      ])
      return { items: rows.map((row) => ({ id: row.id, label: toLabel(row), deactivatedAt: row.updatedAt })), total }
    },
    async restore({ prisma, companyId }, recordId) {
      const row = await find(prisma, companyId, recordId)
      await prisma[delegate].update({ where: { id: row.id }, data: { enabled: true } })
      return { id: row.id, label: toLabel(row) }
    },
    async purge({ prisma, companyId }, recordId) {
      const row = await find(prisma, companyId, recordId)
      try {
        await prisma[delegate].delete({ where: { id: row.id } })
      } catch (error) {
        if (isForeignKeyViolation(error)) throw new TrashInUseError()
        throw error
      }
      return { id: row.id, label: toLabel(row) }
    },
  }
}

export const contains = (term) => ({ contains: term, mode: 'insensitive' })

export const CORE_TRASH_PROVIDERS = Object.freeze([
  prismaProvider({
    id: 'runly.inventory:item', moduleKey: 'runly.inventory', moduleName: 'Inventario',
    label: 'Artículo', pluralLabel: 'Artículos', restorePermission: 'inventory.item.delete', delegate: 'invItem',
    select: { id: true, name: true, assetTag: true, updatedAt: true },
    toLabel: (row) => [row.name, row.assetTag].filter(Boolean).join(' · '),
    searchWhere: (term) => ({ OR: [{ name: contains(term) }, { assetTag: contains(term) }] }),
  }),
  prismaProvider({
    id: 'runly.contacts:contact', moduleKey: 'runly.contacts', moduleName: 'Contactos',
    label: 'Contacto', pluralLabel: 'Contactos', restorePermission: 'contacts.contacts.update', delegate: 'contact',
    select: { id: true, name: true, updatedAt: true },
    toLabel: (row) => row.name,
    searchWhere: (term) => ({ name: contains(term) }),
  }),
  prismaProvider({
    id: 'runly.hr:employee', moduleKey: 'runly.hr', moduleName: 'Recursos humanos',
    label: 'Colaborador', pluralLabel: 'Colaboradores', restorePermission: 'hr.employee.delete', delegate: 'hrEmployee',
    select: { id: true, firstName: true, lastName: true, employeeCode: true, updatedAt: true },
    toLabel: (row) => [`${row.firstName ?? ''} ${row.lastName ?? ''}`.trim(), row.employeeCode].filter(Boolean).join(' · '),
    searchWhere: (term) => ({ OR: [{ firstName: contains(term) }, { lastName: contains(term) }, { employeeCode: contains(term) }] }),
  }),
])
