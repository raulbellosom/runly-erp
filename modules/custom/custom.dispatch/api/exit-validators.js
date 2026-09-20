import { z } from 'zod'

const uuid = z.uuid()

export const scanGateSchema = z.object({
  gate_station_id: uuid,
  qr_value: z.string().trim().min(1).max(500),
})

export const rejectExitSchema = z.object({
  rejection_reason: z.string().trim().min(1).max(2000),
})

export const guardNotifiedSchema = z.object({
  communication_method: z.enum(['RADIO', 'PHONE', 'IN_PERSON', 'OTHER']),
  notes: z.string().trim().max(2000).nullable().optional(),
})
