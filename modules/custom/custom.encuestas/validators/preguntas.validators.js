import { z } from 'zod'

const tipos = z.enum([
  'texto_corto',
  'texto_largo',
  'opcion_unica',
  'opcion_multiple',
  'si_no',
  'numero',
  'calificacion',
])

export const createPreguntaSchema = z.object({
  texto: z.string().trim().min(1).max(1000),
  tipo: tipos,
  obligatoria: z.boolean().optional(),
  opciones: z.array(z.string().trim().min(1).max(300)).max(50).optional(),
  posicion: z.number().int().min(0).optional(),
  ayuda: z.string().trim().max(1000).optional().nullable(),
})

export const updatePreguntaSchema = createPreguntaSchema.partial()
