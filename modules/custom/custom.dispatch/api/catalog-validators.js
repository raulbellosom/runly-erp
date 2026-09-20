import { z } from 'zod'

const code = z.string().trim().min(1).max(48)
const name = z.string().trim().min(1).max(160)
const nullableText = (max) => z.string().trim().max(max).nullable().optional()
const uuid = z.uuid()

const schemas = {
  sites: z.object({
    code: code.max(32),
    name,
    timezone: z.string().trim().min(1).max(80).default('America/Mexico_City'),
    address_text: nullableText(500),
  }),
  stations: z.object({
    site_id: uuid,
    code: code.max(32),
    name,
    station_type: z.enum(['SALES', 'SCALE', 'GATE']),
    location_note: nullableText(500),
  }),
  assignments: z.object({
    station_id: uuid,
    user_id: uuid,
    assignment_type: z.enum(['OPERATOR', 'SUPERVISOR', 'GUARD']),
    receives_exit_alerts: z.boolean().default(false),
  }),
  materials: z.object({
    site_id: uuid,
    catalog_product_id: uuid.nullable().optional(),
    code,
    name,
    allowed_modes: z.array(z.enum(['M3', 'TONS'])).min(1).max(2),
    density_kg_m3: z.number().positive().nullable().optional(),
  }),
  series: z.object({
    site_id: uuid,
    voucher_type: z.enum(['SCALE', 'VOLUME']),
    prefix: z.string().trim().min(1).max(12),
    next_number: z.number().int().min(1).default(1),
    padding: z.number().int().min(1).max(12).default(6),
  }),
}

export const enabledSchema = z.object({ enabled: z.boolean() })
export const idSchema = z.uuid()

export function parseCatalogPayload(resource, input, { partial = false } = {}) {
  const schema = schemas[resource]
  if (!schema) {
    return { success: false, error: { issues: [{ message: 'Catálogo no reconocido.' }] } }
  }

  if (partial && (!input || typeof input !== 'object' || Object.keys(input).length === 0)) {
    return { success: false, error: { issues: [{ path: [], message: 'Envía al menos un campo.' }] } }
  }

  const selected = partial ? schema.partial() : schema

  return selected.safeParse(input)
}

export const catalogResources = Object.freeze(Object.keys(schemas))
