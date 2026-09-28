import { z } from 'zod'

const estadoSchema = z.enum(['borrador', 'publicada', 'cerrada'])

export const createEncuestaSchema = z.object({
  titulo: z.string().trim().min(1).max(180),
  descripcion: z.string().trim().max(4000).optional().nullable(),
  estado: estadoSchema.optional(),
  anonima: z.boolean().optional(),
  solicitar_contacto: z.boolean().optional(),
  capturar_contexto_inventario: z.boolean().optional(),
  fecha_inicio: z.string().trim().max(80).optional().nullable(),
  fecha_cierre: z.string().trim().max(80).optional().nullable(),
  mensaje_final: z.string().trim().max(1000).optional().nullable(),
})

export const updateEncuestaSchema = createEncuestaSchema.partial()

export const changeEstadoSchema = z.object({
  estado: estadoSchema,
})
