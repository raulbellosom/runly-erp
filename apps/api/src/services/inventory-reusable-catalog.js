import { z } from 'zod';
import { InventoryServiceError } from './inventory-service.js';

// Models carry the full identity of a product line: type + brand + name, and
// optionally the year. Types only use name/description (they are brand-agnostic).
export const reusableCatalogSchema = z.object({
  name: z.string().trim().min(1).max(255),
  brandName: z.string().trim().max(255).optional(),
  itemType: z.string().trim().max(50).optional(),
  year: z.number().int().min(1900).max(2100).optional(),
  description: z.string().max(2000).optional(),
}).strict();
export const INVENTORY_BASE_TYPES = ['hardware', 'software', 'license', 'equipment', 'furniture', 'vehicle', 'consumable', 'other'];
export const INVENTORY_BASE_TYPE_LABELS = ['Hardware', 'Software', 'Licencia', 'Equipo', 'Mobiliario', 'Vehículo', 'Consumible', 'Otro'];

function searchTokens(search) {
  return String(search ?? '').slice(0, 200).trim().split(/\s+/).filter(Boolean).slice(0, 10)
    .map(token => token.replace(/[\\%_]/g, '\\$&'));
}

export function createInventoryReusableCatalog({ prisma }) {
  function assertScope(companyId, kind) {
    if (!companyId || !['model', 'type'].includes(kind)) throw new InventoryServiceError('Catálogo no válido.', 400);
  }
  // Every search word must appear in some model field (name, brand, type, year
  // or description), so "dell 2023 xps" finds "XPS 15 · Dell · 2023".
  async function list({ companyId, kind, search = '' }) {
    assertScope(companyId, kind);
    const tokens = searchTokens(search);
    return prisma.$queryRaw`SELECT id, name, details FROM inventory_reusable_catalog WHERE company_id = ${companyId}::uuid
      AND kind = ${kind}
      AND NOT EXISTS (SELECT 1 FROM unnest(${tokens}::text[]) AS t(token)
        WHERE concat_ws(' ', name, details->>'brandName', details->>'itemType', details->>'typeLabel', details->>'year', details->>'description')
          NOT ILIKE '%' || t.token || '%')
      ORDER BY name LIMIT 200`;
  }
  async function create({ companyId, kind, input }) {
    assertScope(companyId, kind);
    const parsed = reusableCatalogSchema.safeParse(input);
    if (!parsed.success) throw new InventoryServiceError('Revisa el nombre y los datos del catálogo.', 400);
    const data = parsed.data;
    if (kind === 'type') {
      if (data.name.length > 50) throw new InventoryServiceError('El tipo admite hasta 50 caracteres.', 400);
      if (data.brandName || data.itemType || data.year) throw new InventoryServiceError('Los tipos son comunes a todas las marcas.', 400);
      if (INVENTORY_BASE_TYPES.includes(data.name.toLowerCase())) return { id: data.name.toLowerCase(), name: data.name.toLowerCase(), details: {}, reused: true };
    }
    let details = data;
    let scopeKey = '';
    if (kind === 'model') {
      if (!data.itemType) throw new InventoryServiceError('Indica el tipo del modelo.', 400);
      if (!data.brandName) throw new InventoryServiceError('Indica la marca del modelo.', 400);
      await assertType(companyId, data.itemType);
      const brand = await prisma.invBrand.findFirst({ where: { companyId, enabled: true, name: { equals: data.brandName, mode: 'insensitive' } } });
      if (!brand) throw new InventoryServiceError('Crea primero la marca del modelo.', 400);
      const baseIndex = INVENTORY_BASE_TYPES.indexOf(data.itemType);
      details = { ...data, brandName: brand.name, brandId: brand.id, typeLabel: baseIndex >= 0 ? INVENTORY_BASE_TYPE_LABELS[baseIndex] : data.itemType };
      // Legacy rows keyed by brand only; the year keeps "XPS 15 2023" and "XPS 15 2024" apart.
      scopeKey = brand.name.toLocaleLowerCase('es') + (data.year ? `|${data.year}` : '');
    }
    const key = data.name.toLocaleLowerCase('es');
    const [row] = await prisma.$queryRaw`INSERT INTO inventory_reusable_catalog (company_id, kind, name, name_key, scope_key, details)
      VALUES (${companyId}::uuid, ${kind}, ${data.name}, ${key}, ${scopeKey}, ${JSON.stringify(details)}::jsonb)
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
