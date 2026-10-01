// apps/api/src/routes/inventory/mirai-capabilities.js
//
// runly.inventory capability for MirAI (spec 2026-09-30-mirai-inventory-
// capability §4). Replaces the former per-module inventory assistant
// (inventory-assistant-service.js, deleted): MirAI now reaches Inventario
// through the same global capability contract as runly.calendar/runly.pfm.
import { createInventoryService } from '../../services/inventory-service.js';
import { createPublicLookup } from '../../services/ai/public-lookup.js';
import { createInventoryMiraiQueries } from './inventory-mirai-queries.js';
import { createInventoryMiraiActions } from './mirai-actions.js';

export function createInventoryMiraiCapabilities({ prisma, publicLookup = createPublicLookup({ env: process.env }) }) {
  const inventoryService = createInventoryService({ prisma });

  return {
    moduleKey: 'runly.inventory',
    label: 'Inventario',
    summary: 'Equipos del inventario: conteos exactos, busqueda, catalogos y especificaciones publicas del fabricante; crear, editar y eliminar equipos.',
    tools: createInventoryMiraiQueries({ prisma, publicLookup }),
    actions: createInventoryMiraiActions({ prisma, inventoryService }),
    publicLookup: [{ model: 'item', publicFields: ['type', 'brand', 'model'] }],
    async describeContext(pageContext, actx) {
      if (pageContext?.recordType === 'item' && pageContext.recordId) {
        const item = await inventoryService.getItem(String(pageContext.recordId), actx.companyId).catch(() => null);
        if (!item) return null;
        const bits = [
          item.assetTag ? `etiqueta ${item.assetTag}` : null,
          item.serialNumber ? `serie ${item.serialNumber}` : null,
          item.brandName ? `marca ${item.brandName}` : null,
          item.model ? `modelo ${item.model}` : null,
          `estado ${item.status}`,
          item.locationName ? `ubicacion ${item.locationName}` : null,
        ].filter(Boolean).join(', ');
        return `El usuario esta viendo el equipo "${item.name}" (itemId ${item.id}), ${bits}.`;
      }
      const selection = pageContext?.selection;
      if (selection?.mode === 'selected' && selection.ids?.length) {
        return `El usuario tiene ${selection.ids.length} equipo(s) seleccionado(s) en Inventario.`;
      }
      if (selection?.mode === 'filtered' && selection.filters && Object.keys(selection.filters).length) {
        return `El usuario esta viendo el inventario con filtros activos: ${JSON.stringify(selection.filters)}.`;
      }
      return 'El usuario esta en el modulo Inventario.';
    },
  };
}
