// inventory-guards.js — error type and tenant guards shared by the inventory services.
export class InventoryServiceError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = 'InventoryServiceError';
    this.status = status;
  }
}

// A missing companyId reaching a Prisma `where` as `undefined` would drop the
// tenant filter entirely, so reject it here.
export function assertCompany(companyId) {
  if (typeof companyId !== 'string' || companyId.trim() === '') {
    throw new InventoryServiceError('companyId es requerido.', 400);
  }
  return companyId;
}

// Rejects a foreign-key reference that belongs to a different company.
export function createRefGuard(prisma) {
  return async function assertRefInCompany(model, id, companyId, label) {
    if (id === undefined || id === null || id === '') return;
    const row = await prisma[model].findFirst({ where: { id, companyId }, select: { id: true } });
    if (!row) throw new InventoryServiceError(`${label} no pertenece a la empresa actual.`, 400);
  };
}
