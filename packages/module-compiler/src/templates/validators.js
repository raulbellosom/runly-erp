import { toPascal, zodFieldSchema } from './helpers.js'

export function generateEntityValidators(entity) {
  const pascal = toPascal(entity.name)
  const fields = entity.fields

  const createFields = fields
    .map((f) => `  ${f.name}: ${zodFieldSchema(f, true)},`)
    .join('\n')

  const updateFields = fields
    .map((f) => `  ${f.name}: ${zodFieldSchema(f, false)},`)
    .join('\n')

  return `import { z } from 'zod'

export const create${pascal}Schema = z.object({
${createFields}
})

export const update${pascal}Schema = z.object({
${updateFields}
})
`
}
