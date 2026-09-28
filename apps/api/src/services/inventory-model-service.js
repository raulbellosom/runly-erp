// inventory-model-service.js — runly.inventory models (InvModel): a product line
// defined by type + brand + name (+ optional year). Items reference it via modelId.
import { z } from 'zod';
import { InventoryServiceError, assertCompany, createRefGuard } from './inventory-guards.js';

const modelInput = z.object({
  name: z.string().trim().min(1).max(255),
  typeId: z.uuid().optional(),
  typeName: z.string().trim().min(1).max(100).optional(),
  brandId: z.uuid().optional(),
  brandName: z.string().trim().min(1).max(100).optional(),
  year: z.number().int().min(1900).max(2100).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
}).strict();

const INCLUDE = {
  type: { select: { name: true, icon: true, color: true } },
  brand: { select: { name: true } },
  _count: { select: { items: { where: { enabled: true } } } },
};

const nameKeyOf = (name) => name.trim().toLocaleLowerCase('es');

function toRow({ type, brand, _count, ...model }) {
  return {
    ...model,
    typeName: type?.name ?? null,
    typeIcon: type?.icon ?? null,
    typeColor: type?.color ?? null,
    brandName: brand?.name ?? null,
    itemCount: _count?.items ?? 0,
  };
}

function parse(schema, input) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new InventoryServiceError('Revisa los datos del modelo.', 400);
  return parsed.data;
}

export function createInventoryModelService({ prisma }) {
  const assertRefInCompany = createRefGuard(prisma);

  // Accepts an id (UI) or a name (import, AI actions).
  async function resolveRef(model, id, name, companyId, noun) {
    if (id) {
      await assertRefInCompany(model, id, companyId, noun === 'tipo' ? 'El tipo' : 'La marca');
      return id;
    }
    if (!name) throw new InventoryServiceError(`Indica ${noun === 'tipo' ? 'el tipo' : 'la marca'} del modelo.`, 400);
    const rows = await prisma[model].findMany({
      where: { companyId, enabled: true, name: { equals: name, mode: 'insensitive' } },
      select: { id: true },
      take: 2,
    });
    if (rows.length !== 1) throw new InventoryServiceError(`${noun === 'tipo' ? 'El tipo' : 'La marca'} «${name}» no existe.`, 400);
    return rows[0].id;
  }

  async function findDuplicate(companyId, brandId, nameKey, year, exceptId) {
    return prisma.invModel.findFirst({
      where: { companyId, brandId, nameKey, year: year ?? null, enabled: true, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
      include: INCLUDE,
    });
  }

  async function list({ companyId, search, typeId, brandId }) {
    assertCompany(companyId);
    const words = String(search ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 10);
    const contains = (value) => ({ contains: value, mode: 'insensitive' });
    const rows = await prisma.invModel.findMany({
      where: {
        companyId,
        enabled: true,
        ...(typeId ? { typeId } : {}),
        ...(brandId ? { brandId } : {}),
        AND: words.map((word) => ({
          OR: [
            { name: contains(word) },
            { description: contains(word) },
            { brand: { name: contains(word) } },
            { type: { name: contains(word) } },
            ...(/^\d{4}$/.test(word) ? [{ year: Number(word) }] : []),
          ],
        })),
      },
      include: INCLUDE,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      take: 500,
    });
    return rows.map(toRow);
  }

  async function create(input, companyId, { reuse = false } = {}) {
    assertCompany(companyId);
    const data = parse(modelInput, input);
    const typeId = await resolveRef('invCategory', data.typeId, data.typeName, companyId, 'tipo');
    const brandId = await resolveRef('invBrand', data.brandId, data.brandName, companyId, 'marca');
    const nameKey = nameKeyOf(data.name);
    const duplicate = await findDuplicate(companyId, brandId, nameKey, data.year);
    if (duplicate) {
      if (reuse) return { ...toRow(duplicate), reused: true };
      throw new InventoryServiceError('El modelo ya existe para esa marca y año.', 409);
    }
    try {
      const created = await prisma.invModel.create({
        data: { companyId, name: data.name, nameKey, typeId, brandId, year: data.year ?? null, description: data.description ?? null },
        include: INCLUDE,
      });
      return toRow(created);
    } catch (err) {
      if (err?.code === 'P2002') throw new InventoryServiceError('El modelo ya existe para esa marca y año.', 409);
      throw err;
    }
  }

  async function update(id, input, companyId) {
    assertCompany(companyId);
    const existing = await prisma.invModel.findFirst({ where: { id, companyId, enabled: true } });
    if (!existing) throw new InventoryServiceError('Modelo no encontrado.', 404);
    const data = parse(modelInput.partial(), input);
    const typeId = data.typeId || data.typeName ? await resolveRef('invCategory', data.typeId, data.typeName, companyId, 'tipo') : existing.typeId;
    const brandId = data.brandId || data.brandName ? await resolveRef('invBrand', data.brandId, data.brandName, companyId, 'marca') : existing.brandId;
    const name = data.name ?? existing.name;
    const year = data.year !== undefined ? data.year : existing.year;
    if (await findDuplicate(companyId, brandId, nameKeyOf(name), year, id)) {
      throw new InventoryServiceError('El modelo ya existe para esa marca y año.', 409);
    }
    const updated = await prisma.invModel.update({
      where: { id },
      data: {
        name, nameKey: nameKeyOf(name), typeId, brandId, year,
        ...(data.description !== undefined ? { description: data.description } : {}),
      },
      include: INCLUDE,
    });
    return toRow(updated);
  }

  async function remove(id, companyId) {
    assertCompany(companyId);
    const existing = await prisma.invModel.findFirst({ where: { id, companyId, enabled: true } });
    if (!existing) throw new InventoryServiceError('Modelo no encontrado.', 404);
    const items = await prisma.invItem.count({ where: { companyId, modelId: id, enabled: true } });
    if (items > 0) throw new InventoryServiceError(`No se puede eliminar: ${items} activo(s) usan este modelo.`, 409);
    return prisma.invModel.update({ where: { id }, data: { enabled: false } });
  }

  // Item create/update: picking a model fills its name and, unless the caller
  // sent them, the item's type (categoryId) and brand.
  async function applyModelDefaults(data, companyId) {
    if (!data?.modelId) return data;
    const model = await prisma.invModel.findFirst({
      where: { id: data.modelId, companyId, enabled: true },
      select: { name: true, typeId: true, brandId: true },
    });
    if (!model) throw new InventoryServiceError('El modelo no existe en esta empresa.', 400);
    return { ...data, model: model.name, categoryId: data.categoryId ?? model.typeId, brandId: data.brandId ?? model.brandId };
  }

  return { list, create, update, remove, applyModelDefaults };
}
