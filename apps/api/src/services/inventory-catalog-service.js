// inventory-catalog-service.js — runly.inventory catalogs: types (InvCategory),
// brands, locations, conditions and custom fields. Extracted from inventory-service.js.
import { InventoryServiceError, assertCompany, createRefGuard } from './inventory-guards.js';

// Seeded once per company (see listCategories) and by the 20260928120000 migration.
export const DEFAULT_INVENTORY_TYPES = [
  { name: 'Laptop', icon: 'Laptop' },
  { name: 'Computadora de escritorio', icon: 'Cpu' },
  { name: 'Monitor', icon: 'Monitor' },
  { name: 'Celular', icon: 'Smartphone' },
  { name: 'Tablet', icon: 'Tablet' },
  { name: 'Impresora', icon: 'Printer' },
  { name: 'Equipo de red', icon: 'Router' },
  { name: 'Periférico', icon: 'Keyboard' },
  { name: 'Licencia de software', icon: 'KeyRound' },
  { name: 'Mobiliario', icon: 'Armchair' },
  { name: 'Herramienta', icon: 'Wrench' },
  { name: 'Vehículo', icon: 'Car' },
];

// Physical conditions seeded the first time a company lists them.
export const DEFAULT_INVENTORY_CONDITIONS = [
  { name: 'Nuevo', color: '#16a34a' },
  { name: 'Semi nuevo', color: '#22c55e' },
  { name: 'Sin usar', color: '#0ea5e9' },
  { name: 'En uso', color: '#6366f1' },
  { name: 'En desuso', color: '#a3a3a3' },
  { name: 'Instalado', color: '#8b5cf6' },
  { name: 'Descompuesto', color: '#dc2626' },
  { name: 'Otros', color: '#78716c' },
];

const enabledOnly = { where: { enabled: true } };

export function createInventoryCatalogService({ prisma }) {
  const assertRefInCompany = createRefGuard(prisma);

  async function assertUnused(where, label) {
    const [items, models] = await Promise.all([
      prisma.invItem.count({ where: { ...where, enabled: true } }),
      where.categoryId || where.brandId
        ? prisma.invModel.count({ where: { companyId: where.companyId, enabled: true, ...(where.categoryId ? { typeId: where.categoryId } : { brandId: where.brandId }) } })
        : 0,
    ]);
    if (models > 0) throw new InventoryServiceError(`No se puede eliminar: ${models} modelo(s) usan ${label}. Muévelos o desactívalos primero.`, 409);
    if (items > 0) throw new InventoryServiceError(`No se puede eliminar: ${items} activo(s) usan ${label}.`, 409);
  }

  // ── Types (InvCategory) ────────────────────────────────────────────────────

  async function ensureDefaultTypes(companyId) {
    // Counts disabled rows too, so a company that removed every type is not re-seeded.
    if (await prisma.invCategory.count({ where: { companyId } }) > 0) return;
    await prisma.invCategory.createMany({
      data: DEFAULT_INVENTORY_TYPES.map((type, index) => ({ companyId, name: type.name, icon: type.icon, sortOrder: index * 10 })),
      skipDuplicates: true,
    });
  }

  async function listCategories(companyId) {
    assertCompany(companyId);
    await ensureDefaultTypes(companyId);
    const rows = await prisma.invCategory.findMany({
      where: { companyId, enabled: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { items: enabledOnly, customFields: enabledOnly, models: enabledOnly } } },
    });
    return rows.map(({ _count, ...row }) => ({ ...row, itemCount: _count?.items ?? 0, customFieldCount: _count?.customFields ?? 0, modelCount: _count?.models ?? 0 }));
  }

  async function createCategory(data, companyId) {
    assertCompany(companyId);
    const { name, description, icon, color, parentId, sortOrder } = data;
    await assertRefInCompany('invCategory', parentId, companyId, 'El tipo padre');
    const createData = { companyId, name };
    if (description !== undefined) createData.description = description;
    if (icon !== undefined) createData.icon = icon;
    if (color !== undefined) createData.color = color;
    if (parentId !== undefined) createData.parentId = parentId;
    if (sortOrder !== undefined) createData.sortOrder = sortOrder;
    return prisma.invCategory.create({ data: createData });
  }

  async function updateCategory(id, data, companyId) {
    assertCompany(companyId);
    const existing = await prisma.invCategory.findFirst({ where: { id, companyId, enabled: true } });
    if (!existing) throw new InventoryServiceError('Category not found', 404);
    const { name, description, icon, color, parentId, sortOrder } = data;
    if (parentId !== undefined && parentId !== null && parentId === id) {
      throw new InventoryServiceError('Un tipo no puede ser su propio padre.', 400);
    }
    await assertRefInCompany('invCategory', parentId, companyId, 'El tipo padre');
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (icon !== undefined) updateData.icon = icon;
    if (color !== undefined) updateData.color = color;
    if (parentId !== undefined) updateData.parentId = parentId;
    if (sortOrder !== undefined) updateData.sortOrder = sortOrder;
    return prisma.invCategory.update({ where: { id }, data: updateData });
  }

  async function deleteCategory(id, companyId) {
    assertCompany(companyId);
    const existing = await prisma.invCategory.findFirst({ where: { id, companyId, enabled: true } });
    if (!existing) throw new InventoryServiceError('Category not found', 404);
    await assertUnused({ companyId, categoryId: id }, 'este tipo');
    return prisma.invCategory.update({ where: { id }, data: { enabled: false } });
  }

  // ── Brands ─────────────────────────────────────────────────────────────────

  async function listBrands(companyId) {
    assertCompany(companyId);
    const rows = await prisma.invBrand.findMany({
      where: { companyId, enabled: true },
      orderBy: { name: 'asc' },
      include: { _count: { select: { items: enabledOnly, models: enabledOnly } } },
    });
    return rows.map(({ _count, ...row }) => ({ ...row, itemCount: _count?.items ?? 0, modelCount: _count?.models ?? 0 }));
  }

  async function createBrand(data, companyId) {
    assertCompany(companyId);
    const { name, description, website } = data;
    const createData = { companyId, name };
    if (description !== undefined) createData.description = description;
    if (website !== undefined) createData.website = website;
    return prisma.invBrand.create({ data: createData });
  }

  async function updateBrand(id, data, companyId) {
    assertCompany(companyId);
    const existing = await prisma.invBrand.findFirst({ where: { id, companyId, enabled: true } });
    if (!existing) throw new InventoryServiceError('Brand not found', 404);
    const { name, description, website } = data;
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (website !== undefined) updateData.website = website;
    return prisma.invBrand.update({ where: { id }, data: updateData });
  }

  async function deleteBrand(id, companyId) {
    assertCompany(companyId);
    const brand = await prisma.invBrand.findFirst({ where: { id, companyId, enabled: true } });
    if (!brand) throw new InventoryServiceError('Brand not found', 404);
    await assertUnused({ companyId, brandId: id }, 'esta marca');
    return prisma.invBrand.update({ where: { id }, data: { enabled: false } });
  }

  // ── Locations ──────────────────────────────────────────────────────────────

  async function listLocations(companyId) {
    assertCompany(companyId);
    const rows = await prisma.invLocation.findMany({
      where: { companyId, enabled: true },
      orderBy: { name: 'asc' },
      include: { _count: { select: { items: enabledOnly } } },
    });
    return rows.map(({ _count, ...row }) => ({ ...row, itemCount: _count?.items ?? 0 }));
  }

  async function createLocation(data, companyId) {
    assertCompany(companyId);
    const { name, description, address } = data;
    const createData = { companyId, name };
    if (description !== undefined) createData.description = description;
    if (address !== undefined) createData.address = address;
    return prisma.invLocation.create({ data: createData });
  }

  async function updateLocation(id, data, companyId) {
    assertCompany(companyId);
    const existing = await prisma.invLocation.findFirst({ where: { id, companyId, enabled: true } });
    if (!existing) throw new InventoryServiceError('Location not found', 404);
    const { name, description, address } = data;
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (address !== undefined) updateData.address = address;
    return prisma.invLocation.update({ where: { id }, data: updateData });
  }

  async function deleteLocation(id, companyId) {
    assertCompany(companyId);
    const location = await prisma.invLocation.findFirst({ where: { id, companyId, enabled: true } });
    if (!location) throw new InventoryServiceError('Location not found', 404);
    await assertUnused({ companyId, locationId: id }, 'esta ubicación');
    return prisma.invLocation.update({ where: { id }, data: { enabled: false } });
  }

  // ── Conditions ─────────────────────────────────────────────────────────────

  async function listConditions(companyId) {
    assertCompany(companyId);
    // Counts disabled rows too, so a company that removed every condition is not re-seeded.
    if (await prisma.invCondition.count({ where: { companyId } }) === 0) {
      await prisma.invCondition.createMany({
        data: DEFAULT_INVENTORY_CONDITIONS.map((c, index) => ({ companyId, name: c.name, color: c.color, sortOrder: index * 10 })),
        skipDuplicates: true,
      });
    }
    const rows = await prisma.invCondition.findMany({
      where: { companyId, enabled: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { items: enabledOnly } } },
    });
    return rows.map(({ _count, ...row }) => ({ ...row, itemCount: _count?.items ?? 0 }));
  }

  async function createCondition(data, companyId) {
    assertCompany(companyId);
    const { name, description, color } = data;
    if (!String(name ?? '').trim()) throw new InventoryServiceError('Indica el nombre de la condición.', 400);
    return prisma.invCondition.create({ data: { companyId, name: String(name).trim(), description: description ?? null, color: color ?? null } });
  }

  async function updateCondition(id, data, companyId) {
    assertCompany(companyId);
    const existing = await prisma.invCondition.findFirst({ where: { id, companyId, enabled: true } });
    if (!existing) throw new InventoryServiceError('Condición no encontrada.', 404);
    const updateData = {};
    for (const field of ['name', 'description', 'color']) if (data[field] !== undefined) updateData[field] = data[field];
    return prisma.invCondition.update({ where: { id }, data: updateData });
  }

  async function deleteCondition(id, companyId) {
    assertCompany(companyId);
    const condition = await prisma.invCondition.findFirst({ where: { id, companyId, enabled: true } });
    if (!condition) throw new InventoryServiceError('Condición no encontrada.', 404);
    await assertUnused({ companyId, conditionId: id }, 'esta condición');
    return prisma.invCondition.update({ where: { id }, data: { enabled: false } });
  }

  // ── Custom Fields ──────────────────────────────────────────────────────────

  // categoryId: a type id (its fields + global ones), 'all' (every field) or
  // empty (global fields only).
  async function listCustomFields(companyId, categoryId) {
    assertCompany(companyId);
    const where = { companyId, enabled: true };
    if (categoryId === 'all') {
      // no type filter
    } else if (categoryId) {
      where.OR = [{ categoryId }, { categoryId: null }];
    } else {
      where.categoryId = null;
    }
    return prisma.invCustomField.findMany({ where, orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }] });
  }

  async function createCustomField(data, companyId) {
    assertCompany(companyId);
    const { label, fieldKey, fieldType, categoryId, options, required, sortOrder } = data;
    await assertRefInCompany('invCategory', categoryId, companyId, 'El tipo');
    const createData = { companyId, label, fieldKey, fieldType };
    if (categoryId !== undefined) createData.categoryId = categoryId;
    if (options !== undefined) createData.options = options;
    if (required !== undefined) createData.required = required;
    if (sortOrder !== undefined) createData.sortOrder = sortOrder;
    return prisma.invCustomField.create({ data: createData });
  }

  async function updateCustomField(id, data, companyId) {
    assertCompany(companyId);
    const existing = await prisma.invCustomField.findFirst({ where: { id, companyId, enabled: true } });
    if (!existing) throw new InventoryServiceError('Custom field not found', 404);
    const { label, fieldKey, fieldType, categoryId, options, required, sortOrder } = data;
    await assertRefInCompany('invCategory', categoryId, companyId, 'El tipo');
    const updateData = {};
    if (label !== undefined) updateData.label = label;
    if (fieldKey !== undefined) updateData.fieldKey = fieldKey;
    if (fieldType !== undefined) updateData.fieldType = fieldType;
    if (categoryId !== undefined) updateData.categoryId = categoryId;
    if (options !== undefined) updateData.options = options;
    if (required !== undefined) updateData.required = required;
    if (sortOrder !== undefined) updateData.sortOrder = sortOrder;
    return prisma.invCustomField.update({ where: { id }, data: updateData });
  }

  async function deleteCustomField(id, companyId) {
    assertCompany(companyId);
    const existing = await prisma.invCustomField.findFirst({ where: { id, companyId, enabled: true } });
    if (!existing) throw new InventoryServiceError('Custom field not found', 404);
    return prisma.invCustomField.update({ where: { id }, data: { enabled: false } });
  }

  // Reorder helpers scope every write by companyId (via updateMany) so a
  // payload referencing another company's rows is a silent no-op, never a write.
  async function reorderCatalog(model, companyId, items) {
    assertCompany(companyId);
    if (!Array.isArray(items)) return;
    await prisma.$transaction(
      items
        .filter((entry) => entry && typeof entry.id === 'string')
        .map(({ id, sortOrder }) => prisma[model].updateMany({ where: { id, companyId }, data: { sortOrder: Number(sortOrder) || 0 } })),
    );
  }

  return {
    listCategories, createCategory, updateCategory, deleteCategory,
    listBrands, createBrand, updateBrand, deleteBrand,
    listLocations, createLocation, updateLocation, deleteLocation,
    listConditions, createCondition, updateCondition, deleteCondition,
    listCustomFields, createCustomField, updateCustomField, deleteCustomField,
    reorderCategories: (companyId, items) => reorderCatalog('invCategory', companyId, items),
    reorderBrands: (companyId, items) => reorderCatalog('invBrand', companyId, items),
    reorderLocations: (companyId, items) => reorderCatalog('invLocation', companyId, items),
    reorderConditions: (companyId, items) => reorderCatalog('invCondition', companyId, items),
    reorderModels: (companyId, items) => reorderCatalog('invModel', companyId, items),
    reorderCustomFields: (companyId, items) => reorderCatalog('invCustomField', companyId, items),
  };
}
