import { z } from 'zod';
import { InventoryServiceError } from './inventory-service.js';

export const reusableCatalogSchema = z.object({ name: z.string().trim().min(1).max(255), brandName: z.string().trim().max(255).optional(), description: z.string().max(2000).optional() }).strict();
export const INVENTORY_BASE_TYPES = ['hardware', 'software', 'license', 'equipment', 'furniture', 'vehicle', 'consumable', 'other'];

export function createInventoryReusableCatalog({ prisma }) {
  function assertScope(companyId, kind) {
    if (!companyId || !['model', 'type'].includes(kind)) throw new InventoryServiceError('Catálogo no válido.', 400);
  }
  async function list({ companyId, kind, search = '' }) {
    assertScope(companyId, kind);
    return prisma.$queryRaw`SELECT id, name, details FROM inventory_reusable_catalog WHERE company_id = ${companyId}::uuid
      AND kind = ${kind} AND name ILIKE ${`%${search.slice(0, 200)}%`} ORDER BY name LIMIT 200`;
  }
  async function create({ companyId, kind, input }) {
    assertScope(companyId, kind);
    const parsed = reusableCatalogSchema.safeParse(input);
    if (!parsed.success) throw new InventoryServiceError('Revisa el nombre y los datos del catálogo.', 400);
    const data = parsed.data;
    if (kind === 'type' && data.name.length > 50) throw new InventoryServiceError('El tipo admite hasta 50 caracteres.', 400);
    if (kind === 'type' && data.brandName) throw new InventoryServiceError('Los tipos son comunes a todas las marcas.', 400);
    if (kind === 'type' && INVENTORY_BASE_TYPES.includes(data.name.toLowerCase())) return { id: data.name.toLowerCase(), name: data.name.toLowerCase(), details: {}, reused: true };
    const scopeKey = data.brandName?.trim().toLocaleLowerCase('es') ?? '';
    if (data.brandName && !await prisma.invBrand.findFirst({ where: { companyId, enabled: true, name: { equals: data.brandName, mode: 'insensitive' } } })) throw new InventoryServiceError('Crea primero la marca del modelo.', 400);
    const key = data.name.toLocaleLowerCase('es');
    const [row] = await prisma.$queryRaw`INSERT INTO inventory_reusable_catalog (company_id, kind, name, name_key, scope_key, details)
      VALUES (${companyId}::uuid, ${kind}, ${data.name}, ${key}, ${scopeKey}, ${JSON.stringify(data)}::jsonb)
      ON CONFLICT (company_id, kind, name_key, scope_key) DO UPDATE SET name = inventory_reusable_catalog.name RETURNING id, name, details, (xmax <> 0) AS reused`;
    return row;
  }
  async function assertType(companyId, value) {
    if (!value || INVENTORY_BASE_TYPES.includes(value)) return;
    const [existing] = await prisma.$queryRaw`SELECT id FROM inventory_reusable_catalog WHERE company_id = ${companyId}::uuid AND kind = 'type' AND name = ${value} LIMIT 1`;
    if (!existing) throw new InventoryServiceError('El tipo no existe en el catálogo de esta empresa.', 400);
  }
  return { list, create, assertType };
}
