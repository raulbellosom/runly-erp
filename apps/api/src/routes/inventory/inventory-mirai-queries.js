// apps/api/src/routes/inventory/inventory-mirai-queries.js
//
// runly.inventory MirAI capability tools (spec 2026-09-30-mirai-inventory-
// capability §4): inventory_summary, inventory_search, inventory_catalogs,
// inventory_public_model. Lifted from the former inventory-assistant-service.js
// (whereFor/summary/search/catalogs/public-lookup logic), re-scoped to the
// capability contract's `selection` (filtered|selected, from the page's
// miraiPageContext) instead of the old per-thread context object.
import { z } from 'zod';
import { createInventoryAccess } from '../../services/inventory-access.js';
import { inventoryFiltersSchema, buildInventoryWhere } from '../../services/inventory-query.js';
import { createInventoryChatActions } from '../../services/inventory-chat-actions.js';

const filterParameters = {
  type: 'object',
  additionalProperties: false,
  properties: Object.fromEntries(
    ['search', 'categoryId', 'brandId', 'locationId', 'status', 'model', 'modelId', 'createdFrom', 'createdTo']
      .map((k) => [k, { type: 'string' }])
      .concat([['missingSerial', { type: 'boolean' }]]),
  ),
};
const queryToolParameters = {
  type: 'object',
  additionalProperties: false,
  properties: { filters: filterParameters, scope: { type: 'string', enum: ['selection', 'company'] } },
};
const queryArgsSchema = z.object({ filters: inventoryFiltersSchema.default({}), scope: z.enum(['selection', 'company']).optional() }).strict();

// -> a where clause for the selection (selected ids or filtered filters),
// scoped to the company, or null when there is no usable selection.
function selectionWhere(companyId, selection) {
  if (!selection) return null;
  if (selection.mode === 'selected') {
    if (!selection.ids?.length) return null;
    return { ...buildInventoryWhere(companyId), id: { in: selection.ids } };
  }
  if (selection.mode === 'filtered') {
    const parsed = inventoryFiltersSchema.safeParse(selection.filters ?? {});
    return buildInventoryWhere(companyId, parsed.success ? parsed.data : {});
  }
  return null;
}

// Default scope is "selection" when the page published one, otherwise "company".
function whereFor(actx, args) {
  const parsed = queryArgsSchema.safeParse(args);
  if (!parsed.success) return null;
  const selection = actx.turn?.pageContext?.selection;
  const scope = parsed.data.scope ?? (selection ? 'selection' : 'company');
  if (scope === 'selection') {
    const base = selectionWhere(actx.companyId, selection);
    if (!base) return null;
    return { AND: [base, buildInventoryWhere(actx.companyId, parsed.data.filters)] };
  }
  return { AND: [buildInventoryWhere(actx.companyId), buildInventoryWhere(actx.companyId, parsed.data.filters)] };
}

export function createInventoryMiraiQueries({ prisma, publicLookup }) {
  const authorize = createInventoryAccess({ prisma }).assertCurrent;
  const chatActions = createInventoryChatActions({ prisma, authorize });

  const inventory_summary = {
    name: 'inventory_summary',
    permission: 'inventory.item.read',
    definition: {
      description: 'Conteos exactos y agrupaciones de los equipos autorizados. Nunca cuentes una muestra como si fuera el total. Permite filtrar por marca, modelo, categoria, fecha o falta de serie; scope "selection" usa la seleccion/filtros activos en la pantalla, "company" ignora la pantalla y consulta toda la empresa.',
      parameters: queryToolParameters,
    },
    async run(args, actx) {
      await authorize({ companyId: actx.companyId, actorId: actx.actorProfileId });
      const where = whereFor(actx, args);
      if (!where) return { error: 'No hay una seleccion o filtros activos en la pantalla; indica scope "company" para consultar toda la empresa.' };
      const [total, missingSerial, groups] = await Promise.all([
        prisma.invItem.count({ where }),
        prisma.invItem.count({ where: { AND: [where, { OR: [{ serialNumber: null }, { serialNumber: '' }] }] } }),
        prisma.invItem.groupBy({ by: ['brandId', 'model', 'categoryId'], where, _count: { id: true }, orderBy: { _count: { id: 'desc' } }, take: 40 }),
      ]);
      const [brands, categories] = await Promise.all([
        prisma.invBrand.findMany({ where: { companyId: actx.companyId, id: { in: [...new Set(groups.map((g) => g.brandId).filter(Boolean))] } }, select: { id: true, name: true } }),
        prisma.invCategory.findMany({ where: { companyId: actx.companyId, id: { in: [...new Set(groups.map((g) => g.categoryId).filter(Boolean))] } }, select: { id: true, name: true } }),
      ]);
      return {
        total, missingSerial, withSerial: total - missingSerial, groupsLimit: 40,
        groups: groups.map((g) => ({
          brandId: g.brandId, brand: brands.find((b) => b.id === g.brandId)?.name ?? null,
          model: g.model, categoryId: g.categoryId, type: categories.find((c) => c.id === g.categoryId)?.name ?? null,
          count: g._count.id,
        })),
      };
    },
  };

  const inventory_search = {
    name: 'inventory_search',
    permission: 'inventory.item.read',
    definition: {
      description: 'Lista hasta 30 equipos autorizados con itemId, marca, modelo y campos personalizados; tambien devuelve el total real. scope "selection" usa la seleccion/filtros activos en la pantalla, "company" consulta toda la empresa.',
      parameters: queryToolParameters,
    },
    async run(args, actx) {
      await authorize({ companyId: actx.companyId, actorId: actx.actorProfileId });
      const where = whereFor(actx, args);
      if (!where) return { error: 'No hay una seleccion o filtros activos en la pantalla; indica scope "company" para consultar toda la empresa.' };
      const [total, items] = await Promise.all([
        prisma.invItem.count({ where }),
        prisma.invItem.findMany({
          where, take: 30, orderBy: { createdAt: 'desc' },
          select: {
            id: true, name: true, assetTag: true, serialNumber: true, partNumber: true, model: true, status: true, createdAt: true,
            description: true, notes: true, purchaseDate: true, warrantyExpiry: true,
            brandId: true, categoryId: true, brand: { select: { name: true } }, category: { select: { name: true } }, location: { select: { name: true } },
            customValues: { take: 20, select: { value: true, field: { select: { label: true } } } },
          },
        }),
      ]);
      return {
        total, returned: items.length, truncated: total > items.length, customFieldsLimit: 20,
        items: items.map((item) => ({
          ...item, itemId: item.id,
          description: item.description?.slice(0, 600) ?? null, notes: item.notes?.slice(0, 1000) ?? null,
          detailsTruncated: (item.description?.length ?? 0) > 600 || (item.notes?.length ?? 0) > 1000 || (item.customValues ?? []).some((value) => (value.value?.length ?? 0) > 300),
          customValues: (item.customValues ?? []).map((value) => ({ ...value, value: value.value?.slice(0, 300) ?? null })),
        })),
      };
    },
  };

  const inventory_catalogs = {
    name: 'inventory_catalogs',
    permission: 'inventory.item.read',
    definition: {
      description: 'Busca marcas, categorias, ubicaciones, modelos, tipos y definiciones de campos personalizados de esta empresa (util antes de proponer una alta). Devuelve hasta 50 por catalogo; filtra por search si no aparece lo buscado.',
      parameters: { type: 'object', additionalProperties: false, properties: { search: { type: 'string' } } },
    },
    async run(args, actx) {
      return chatActions.catalogs({ companyId: actx.companyId, actorId: actx.actorProfileId }, typeof args?.search === 'string' ? args.search : '');
    },
  };

  const inventory_public_model = {
    name: 'inventory_public_model',
    permission: 'inventory.item.read',
    definition: {
      description: 'Busca en internet informacion publica (especificaciones del fabricante) del tipo, marca y modelo de un equipo autorizado. Solo cuando el usuario lo pida explicitamente; nunca envia seriales ni datos de la empresa.',
      parameters: { type: 'object', additionalProperties: false, properties: { itemId: { type: 'string' } }, required: ['itemId'] },
    },
    async run(args, actx) {
      await authorize({ companyId: actx.companyId, actorId: actx.actorProfileId });
      if (!publicLookup?.enabled) return { error: 'La busqueda en internet no esta configurada.' };
      const parsed = z.object({ itemId: z.string().uuid() }).strict().safeParse(args);
      if (!parsed.success) return { error: 'Identificador invalido.' };
      const item = await prisma.invItem.findFirst({
        where: { ...buildInventoryWhere(actx.companyId), id: parsed.data.itemId },
        select: { id: true, model: true, brand: { select: { name: true } }, category: { select: { name: true } } },
      });
      if (!item) return { error: 'Equipo no disponible en esta empresa.' };
      if (!item.model || !item.brand?.name) return { error: 'Falta la marca o el modelo para buscar informacion publica.' };
      actx.turn ??= {};
      actx.turn.inventoryPublicLookupBudget ??= publicLookup.createTurnBudget();
      const result = await publicLookup.lookup({ subject: { type: item.category?.name, brand: item.brand.name, model: item.model }, budget: actx.turn.inventoryPublicLookupBudget });
      await prisma.auditLog.create({ data: { companyId: actx.companyId, actorId: actx.actorProfileId, moduleKey: 'runly.inventory', action: 'inventory.ai.public_lookup', metadata: { itemId: item.id, query: result.query ?? null } } }).catch(() => {});
      return result;
    },
  };

  return [inventory_summary, inventory_search, inventory_catalogs, inventory_public_model];
}
