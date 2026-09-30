import { z } from 'zod';

const text = (max) => z.string().max(max).nullable().optional();
const ref = z.uuid().nullable().optional();
const date = z.iso.date().nullable().optional();
export const inventoryCommonSchema = z.object({
  // Optional: a blank name is generated from brand/type/model on create.
  name: z.string().trim().max(255).optional().default(''),
  description: text(2000),
  modelId: ref,
  categoryId: ref, brandId: ref, locationId: ref,
  model: text(255), partNumber: text(255),
  status: z.enum(['available', 'maintenance']).default('available'),
  adminStatus: z.enum(['registered', 'registration_pending']).default('registered'),
  conditionId: ref,
  purchaseDate: date, purchasePrice: z.number().finite().min(0).max(9999999999.99).nullable().optional(),
  acquisitionOrigin: z.enum(['PURCHASE', 'DONATION', 'TRANSFER', 'LEASE', 'INTERNAL', 'INITIAL_STOCK', 'OTHER']).optional(),
  vendorName: text(255), invoiceNumber: text(100), warrantyExpiry: date, warrantyNotes: text(500), notes: text(2000),
  customValues: z.array(z.object({ fieldId: z.uuid(), value: text(2000) })).max(100).optional(),
});
const identifiers = z.object({ serialNumber: text(255), partNumber: text(255), assetTag: text(100) });
export const intakeSchema = z.object({
  key: z.string().regex(/^[a-f0-9]{32,64}$/),
  common: inventoryCommonSchema,
  units: z.array(identifiers.extend({
    confirmedIdentifiers: identifiers.optional(),
    // Optional per-unit name (bulk capture by serial uses "Nombre · serie").
    name: z.string().trim().min(1).max(255).optional(),
    duplicateAcknowledged: z.boolean().default(false),
    sourceImageIds: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(50).default([]),
  })).min(1).max(200),
  proofs: z.array(z.string().max(80000)).max(50).default([]),
});
export const observationSchema = z.object({
  rawText: z.string().max(8000).default(''),
  observations: z.array(z.object({
    field: z.enum(['name', 'categoryName', 'brandName', 'model', 'partNumber', 'serialNumber', 'productCode', 'description']),
    value: z.string().max(2000).nullable(),
    status: z.enum(['observed', 'uncertain', 'unreadable']),
  })).max(100),
  warnings: z.array(z.string().max(500)).max(10).default([]),
});
