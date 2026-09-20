import { z } from 'zod'

const uuid = z.uuid()
const weightKg = z.number().positive()

export const captureTareSchema = z.object({
  station_id: uuid,
  weight_kg: weightKg,
  source: z.enum(['MANUAL', 'DEVICE']).default('MANUAL'),
  device_reference: z.string().trim().max(120).nullable().optional(),
})

export const captureGrossSchema = captureTareSchema
export const captureAuxiliaryExitSchema = captureTareSchema

export const correctWeighingSchema = z.object({
  weight_kg: weightKg,
  correction_reason: z.string().trim().min(1).max(2000),
  source: z.enum(['MANUAL', 'DEVICE']).default('MANUAL'),
  device_reference: z.string().trim().max(120).nullable().optional(),
})

export const weighingExceptionSchema = z.object({
  reason: z.string().trim().min(1).max(2000),
})
