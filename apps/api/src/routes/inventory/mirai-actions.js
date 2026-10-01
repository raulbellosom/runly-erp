// apps/api/src/routes/inventory/mirai-actions.js
//
// runly.inventory actions MirAI can propose (spec 2026-09-30-mirai-inventory-
// capability §4): inventory.plan.create wraps the existing intake plan
// (inventory-chat-actions.js, unchanged) exactly as inventory-chat-service.js's
// decide() executed a confirmed plan — same transaction + advisory lock.
// inventory.item.update/delete go through the same inventoryService functions
// the HTTP routes use (routes/inventory/index.js), with the same permissions.
import { z } from 'zod';
import { createInventoryChatActions, INVENTORY_ACTION_TOOLS } from '../../services/inventory-chat-actions.js';

const LINK = (id) => `/app/m/runly.inventory?itemId=${id}`;
const KIND_LABEL = { brand: 'Marca', category: 'Tipo', location: 'Ubicacion', model: 'Modelo', customField: 'Campo personalizado', item: 'Equipo' };
const optText = (max) => z.string().trim().max(max).nullable().optional();
function dayKey(value) {
  if (!value) return null;
  // eslint-disable-next-line no-restricted-syntax -- deliberate UTC: @db.Date purchaseDate/warrantyExpiry
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

const updateArgs = z.object({
  itemId: z.string().min(1),
  name: z.string().trim().min(1).max(255).optional(),
  status: z.enum(['available', 'maintenance']).optional(),
  location: optText(120),
  serialNumber: optText(255),
  assetTag: optText(100),
  notes: optText(2000),
  model: z.string().trim().max(255).optional(),
  purchaseDate: z.iso.date().nullable().optional(),
  warrantyExpiry: z.iso.date().nullable().optional(),
}).strict();
const deleteArgs = z.object({ itemId: z.string().min(1) }).strict();

const prepareCreateDef = INVENTORY_ACTION_TOOLS.find((t) => t.function.name === 'inventory_prepare_create').function;

export function createInventoryMiraiActions({ prisma, inventoryService }) {
  const chatActions = createInventoryChatActions({ prisma });

  async function resolveLocation(actx, name) {
    if (!name) return { location: null };
    const matches = await prisma.invLocation.findMany({ where: { companyId: actx.companyId, enabled: true, name: { contains: name, mode: 'insensitive' } }, take: 5, select: { id: true, name: true } });
    const exact = matches.filter((l) => l.name.toLowerCase() === name.toLowerCase());
    const candidates = exact.length ? exact : matches;
    if (candidates.length === 1) return { location: candidates[0] };
    if (!candidates.length) return { error: `No encontre la ubicacion "${name}".` };
    return { error: `Hay varias ubicaciones que coinciden: ${candidates.map((l) => l.name).join(', ')}.` };
  }

  async function loadItem(actx, itemId) {
    try {
      const item = await inventoryService.getItem(itemId, actx.companyId);
      return { item };
    } catch {
      return { error: 'No encontre ese equipo. Usa inventory_search para obtener su itemId.' };
    }
  }

  const planCreate = {
    key: 'inventory.plan.create',
    moduleKey: 'runly.inventory',
    operation: 'create',
    label: 'Dar de alta equipos',
    permission: 'inventory.item.read', // per-kind permissions are checked by prepare()/execute() below, like the assistant did.
    description: prepareCreateDef.description,
    parameters: prepareCreateDef.parameters,
    async prepare(args, actx) {
      const scope = { companyId: actx.companyId, actorId: actx.actorProfileId };
      let proposal;
      try {
        proposal = await chatActions.prepare(args, scope);
      } catch (err) {
        return { error: String(err?.message ?? err).slice(0, 300) };
      }
      return {
        input: proposal,
        preview: {
          title: 'Dar de alta equipos',
          fields: proposal.actions.map((a) => ({
            label: KIND_LABEL[a.kind] ?? a.kind,
            value: a.data.name || [a.data.model, a.data.serialNumber].filter(Boolean).join(' / ') || '(sin nombre)',
          })),
        },
      };
    },
    async execute(input, actx) {
      const scope = { companyId: actx.companyId, actorId: actx.actorProfileId, authUserId: actx.actorAuthUserId };
      // Same transaction + advisory-lock call inventory-chat-service.js's decide()
      // used to execute a confirmed plan (chatActions.execute acquires the lock).
      const results = await actx.prisma.$transaction((db) => chatActions.execute(input, scope, db), { timeout: 30000 });
      const created = results.filter((r) => r.kind === 'item');
      return {
        summary: `Creados ${results.length} registro(s)${created.length ? `: ${created.map((r) => r.assetTag || r.name).join(', ')}` : ''}.`,
        results,
        link: '/app/m/runly.inventory',
      };
    },
  };

  const update = {
    key: 'inventory.item.update',
    moduleKey: 'runly.inventory',
    operation: 'update',
    label: 'Editar equipo',
    permission: 'inventory.item.update',
    description: 'Cambia un equipo existente (nombre, estado, ubicacion, serie, etiqueta, notas, modelo, fechas de compra/garantia). Requiere el itemId de inventory_search; envia solo los campos que cambian.',
    parameters: {
      type: 'object',
      properties: {
        itemId: { type: 'string' },
        name: { type: 'string' },
        status: { type: 'string', enum: ['available', 'maintenance'] },
        location: { type: 'string' },
        serialNumber: { type: 'string' },
        assetTag: { type: 'string' },
        notes: { type: 'string' },
        model: { type: 'string' },
        purchaseDate: { type: 'string', description: 'YYYY-MM-DD' },
        warrantyExpiry: { type: 'string', description: 'YYYY-MM-DD' },
      },
      required: ['itemId'],
    },
    async prepare(args, actx) {
      const parsed = updateArgs.safeParse(args);
      if (!parsed.success) return { error: 'Indica el itemId (de inventory_search) y los campos a cambiar.' };
      const a = parsed.data;
      const found = await loadItem(actx, a.itemId);
      if (found.error) return { error: found.error };
      const { item } = found;
      const data = {};
      const fields = [{ label: 'Equipo', value: item.name }];

      if (a.name !== undefined && a.name !== item.name) { data.name = a.name; fields.push({ label: 'Nombre', before: item.name, value: a.name }); }
      if (a.status !== undefined && a.status !== item.status) { data.status = a.status; fields.push({ label: 'Estado', before: item.status, value: a.status }); }
      if (a.location !== undefined) {
        const loc = await resolveLocation(actx, a.location);
        if (loc.error) return { error: loc.error };
        const newId = loc.location?.id ?? null;
        if (newId !== (item.locationId ?? null)) { data.locationId = newId; fields.push({ label: 'Ubicacion', before: item.locationName ?? '(sin ubicacion)', value: loc.location?.name ?? '(sin ubicacion)' }); }
      }
      if (a.serialNumber !== undefined && (a.serialNumber ?? null) !== (item.serialNumber ?? null)) { data.serialNumber = a.serialNumber ?? null; fields.push({ label: 'Serie', before: item.serialNumber ?? '(vacio)', value: a.serialNumber ?? '(vacio)' }); }
      if (a.assetTag !== undefined && (a.assetTag ?? null) !== (item.assetTag ?? null)) { data.assetTag = a.assetTag ?? null; fields.push({ label: 'Etiqueta', before: item.assetTag ?? '(vacio)', value: a.assetTag ?? '(vacio)' }); }
      if (a.notes !== undefined && (a.notes ?? null) !== (item.notes ?? null)) { data.notes = a.notes ?? null; fields.push({ label: 'Notas', before: item.notes ?? '(vacio)', value: a.notes ?? '(vacio)' }); }
      if (a.model !== undefined && a.model !== (item.model ?? '')) { data.model = a.model; fields.push({ label: 'Modelo', before: item.model ?? '(vacio)', value: a.model }); }
      if (a.purchaseDate !== undefined && a.purchaseDate !== dayKey(item.purchaseDate)) { data.purchaseDate = a.purchaseDate; fields.push({ label: 'Compra', before: dayKey(item.purchaseDate) ?? '(vacio)', value: a.purchaseDate ?? '(vacio)' }); }
      if (a.warrantyExpiry !== undefined && a.warrantyExpiry !== dayKey(item.warrantyExpiry)) { data.warrantyExpiry = a.warrantyExpiry; fields.push({ label: 'Garantia', before: dayKey(item.warrantyExpiry) ?? '(vacio)', value: a.warrantyExpiry ?? '(vacio)' }); }

      if (!Object.keys(data).length) return { error: 'No indicaste ningun cambio respecto al equipo actual.' };
      return { input: { itemId: item.id, data }, targetId: item.id, preview: { title: 'Editar equipo', fields } };
    },
    async execute(input, actx) {
      const item = await inventoryService.updateItem(input.itemId, input.data, actx.companyId);
      return { id: item.id, summary: `Equipo actualizado: ${item.name}`, link: LINK(item.id) };
    },
  };

  const remove = {
    key: 'inventory.item.delete',
    moduleKey: 'runly.inventory',
    operation: 'delete',
    label: 'Eliminar equipo',
    permission: 'inventory.item.delete',
    description: 'Elimina (da de baja logica) un equipo existente. Requiere el itemId de inventory_search.',
    parameters: { type: 'object', properties: { itemId: { type: 'string' } }, required: ['itemId'] },
    async prepare(args, actx) {
      const parsed = deleteArgs.safeParse(args);
      if (!parsed.success) return { error: 'Indica el itemId (de inventory_search).' };
      const found = await loadItem(actx, parsed.data.itemId);
      if (found.error) return { error: found.error };
      const { item } = found;
      return {
        input: { itemId: item.id },
        targetId: item.id,
        preview: {
          title: 'Eliminar equipo',
          fields: [
            { label: 'Equipo', value: item.name },
            item.assetTag ? { label: 'Etiqueta', value: item.assetTag } : null,
            item.serialNumber ? { label: 'Serie', value: item.serialNumber } : null,
          ].filter(Boolean),
        },
      };
    },
    async execute(input, actx) {
      await inventoryService.deleteItem(input.itemId, actx.companyId);
      return { id: input.itemId, summary: 'Equipo eliminado.' };
    },
  };

  return [planCreate, update, remove];
}
