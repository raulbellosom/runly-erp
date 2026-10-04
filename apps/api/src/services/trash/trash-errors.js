// Desactivados (spec 2026-10-03-records-trash-design §9): errors shared by
// every trash provider.

export class TrashError extends Error {
  constructor(message, status = 400, code = 'trash_error', details = null) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

// A foreign key still points at the record (another record, a Connections
// "Impedir la eliminación" link...): nothing was deleted.
export class TrashInUseError extends TrashError {
  constructor(detail = '') {
    super(`No se puede eliminar definitivamente: otros registros dependen de este${detail ? ` (${detail})` : ''}. Reactívalo o elimina primero lo que lo usa.`, 409, 'in_use')
  }
}

const FK_CODES = new Set(['23503', 'P2003'])

export function isForeignKeyViolation(error) {
  if (!error) return false
  if (FK_CODES.has(error.code) || FK_CODES.has(error.meta?.code)) return true
  // Raw queries through the Prisma adapter wrap the Postgres error.
  return /23503|foreign key constraint/i.test(String(error.message ?? ''))
}

// Constraint name of a Postgres FK error, when present.
export function constraintOf(error) {
  const text = `${error?.meta?.constraint ?? ''} ${error?.message ?? ''}`
  return /constraint "([^"]+)"/.exec(text)?.[1] ?? error?.meta?.constraint ?? null
}
