import { z } from 'zod';
import { getConfiguredTimeZone } from '@runly/core';

export function inventoryDayStart(value, dayOffset = 0, timeZone = getConfiguredTimeZone()) {
  const [year, month, day] = value.split('-').map(Number);
  const target = Date.UTC(year, month - 1, day + dayOffset);
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  let instant = target;
  for (let attempt = 0; attempt < 4; attempt++) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map(p => [p.type, p.value]));
    const local = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    if (local === target) break;
    instant += target - local;
  }
  return new Date(instant);
}

export const inventoryFiltersSchema = z.object({
  search: z.string().max(200).optional(),
  categoryId: z.uuid().optional(), brandId: z.uuid().optional(), locationId: z.uuid().optional(), assignedToId: z.uuid().optional(),
  status: z.enum(['available', 'assigned', 'maintenance', 'retired', 'lost', 'stolen', 'disposed']).optional(),
  model: z.string().max(255).optional(), itemType: z.string().max(50).optional(),
  missingSerial: z.boolean().optional(), createdFrom: z.iso.date().optional(), createdTo: z.iso.date().optional(),
}).strict();

export function buildInventoryWhere(companyId, filters = {}) {
  if (!companyId) throw new Error('Empresa requerida.');
  const where = { companyId, enabled: true };
  const q = String(filters.search ?? '').trim();
  if (q) where.OR = ['name', 'assetTag', 'serialNumber'].map(field => ({ [field]: { contains: q, mode: 'insensitive' } }));
  for (const field of ['categoryId', 'brandId', 'locationId', 'assignedToId', 'status', 'model', 'itemType']) if (filters[field]) where[field] = filters[field];
  if (filters.missingSerial) where.AND = [{ OR: [{ serialNumber: null }, { serialNumber: '' }] }];
  if (filters.createdFrom || filters.createdTo) where.createdAt = {
    ...(filters.createdFrom ? { gte: inventoryDayStart(filters.createdFrom) } : {}),
    ...(filters.createdTo ? { lt: inventoryDayStart(filters.createdTo, 1) } : {}),
  };
  return where;
}
