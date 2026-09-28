import { z } from 'zod'

export const createRespuestaSchema = z.object({
  respondente_nombre: z.string().trim().max(200).optional().nullable(),
  respondente_correo: z.string().trim().email().max(320).optional().nullable(),
  respuestas: z.object({}).catchall(z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.string()),
    z.null(),
  ])),
})
