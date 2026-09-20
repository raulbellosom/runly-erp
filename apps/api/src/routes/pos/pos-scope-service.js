import { PosServiceError, requireCompanyId } from './service-helpers.js';

// Foreign keys guarantee existence, not that both records belong to the same
// company/outlet. Validate references before creating or changing any records.
export function createPosScopeService({ prisma }) {
  async function find(model, companyId, id, extra = {}) {
    requireCompanyId(companyId);
    if (!id) throw new PosServiceError('Recurso POS no encontrado.', 404);
    const row = await prisma[model].findFirst({ where: { id, companyId, ...extra } });
    if (!row) throw new PosServiceError('Recurso POS no encontrado.', 404);
    return row;
  }

  async function outlet(companyId, outletId) {
    return find('posOutlet', companyId, outletId);
  }

  async function terminal(companyId, outletId, terminalId) {
    return find('posTerminal', companyId, terminalId, { outletId });
  }

  async function session(companyId, outletId, sessionId, terminalId) {
    const row = await find('posSession', companyId, sessionId, {
      outletId, ...(terminalId ? { terminalId } : {}),
    });
    if (row.status !== 'OPEN') throw new PosServiceError('La sesion de caja no esta abierta.', 409);
    return row;
  }

  async function table(companyId, outletId, tableId) {
    return find('posTable', companyId, tableId, { floor: { companyId, outletId } });
  }

  async function zone(companyId, floorId, zoneId) {
    if (!zoneId) return;
    // Zones inherit their company from their floor.
    const row = await prisma.posFloorZone.findFirst({ where: { id: zoneId, floorId, floor: { companyId } } });
    if (!row) throw new PosServiceError('Zona POS no encontrada.', 404);
    return row;
  }

  async function guest(companyId, orderId, guestSeatId) {
    if (!guestSeatId) return;
    const row = await prisma.posGuestSeat.findFirst({ where: { id: guestSeatId, orderId, order: { companyId } } });
    if (!row) throw new PosServiceError('Comensal no encontrado.', 404);
    return row;
  }

  async function order(companyId, data) {
    await outlet(companyId, data.outletId);
    if (data.terminalId) await terminal(companyId, data.outletId, data.terminalId);
    if (data.sessionId) await session(companyId, data.outletId, data.sessionId, data.terminalId);
    if (data.tableId) await table(companyId, data.outletId, data.tableId);
  }

  return { outlet, terminal, session, table, zone, guest, order };
}
