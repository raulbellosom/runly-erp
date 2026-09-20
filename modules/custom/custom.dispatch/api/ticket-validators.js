import { z } from 'zod'

const uuid = z.uuid()
const plate = z.string().trim().min(1).max(20).transform((value) => value.toUpperCase())
const nullableText = (max) => z.string().trim().max(max).nullable().optional()

export const createVolumeTicketSchema = z.object({
  site_id: uuid,
  origin_station_id: uuid,
  material_profile_id: uuid,
  sold_to_type: z.enum(['CUSTOMER', 'WALK_IN']).default('WALK_IN'),
  customer_contact_id: uuid.nullable().optional(),
  customer_name: nullableText(200),
  buyer_email: z.email().nullable().optional(),
  external_voucher_reference: nullableText(80),
  vehicle_plate: plate,
  driver_name: nullableText(160),
  sold_volume_m3: z.number().positive(),
  requested_quantity: z.number().positive().nullable().optional(),
  payment_method: z.enum(['CASH', 'DEPOSIT', 'OTHER']).nullable().optional(),
  payment_reference: nullableText(120),
})

export const createScaleTicketSchema = z.object({
  site_id: uuid,
  origin_station_id: uuid,
  material_profile_id: uuid,
  sold_to_type: z.enum(['CUSTOMER', 'WALK_IN']).default('CUSTOMER'),
  customer_contact_id: uuid.nullable().optional(),
  customer_name: z.string().trim().min(1).max(200),
  buyer_email: z.email().nullable().optional(),
  external_voucher_reference: nullableText(80),
  vehicle_plate: plate,
  driver_name: nullableText(160),
  requested_quantity: z.number().positive().nullable().optional(),
})

export const updateTicketSchema = z.object({
  customer_name: nullableText(200),
  buyer_email: z.email().nullable().optional(),
  external_voucher_reference: nullableText(80),
  vehicle_plate: plate.optional(),
  driver_name: nullableText(160),
  payment_method: z.enum(['CASH', 'DEPOSIT', 'OTHER']).nullable().optional(),
  payment_reference: nullableText(120),
}).refine((data) => Object.keys(data).length > 0, { message: 'Envía al menos un campo.' })

export const cancelTicketSchema = z.object({
  reason: z.string().trim().min(1).max(2000),
})

export const listTicketsQuerySchema = z.object({
  status: z.enum(['CREATED', 'READY_FOR_EXIT', 'PENDING_APPROVAL', 'CORRECTION_REQUIRED', 'USED', 'CANCELLED', 'EXPIRED']).optional(),
  voucher_type: z.enum(['SCALE', 'VOLUME']).optional(),
  site_id: uuid.optional(),
  q: z.string().trim().max(80).optional(),
})
