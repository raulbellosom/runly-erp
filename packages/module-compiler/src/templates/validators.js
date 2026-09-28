import { toPascal, zodFieldSchema } from './helpers.js'
import { conditionalRequiredFields } from '../layout.js'

export function generateEntityValidators(entity) {
  const pascal = toPascal(entity.name)
  const fields = entity.fields
  // Required fields the layout can hide are optional here; the generated
  // route enforces them only while visible (see templates/visibility.js).
  const conditional = new Set(conditionalRequiredFields(entity).map((entry) => entry.field))

  const createFields = fields
    .map((f) => `  ${f.name}: ${zodFieldSchema(conditional.has(f.name) ? { ...f, required: false } : f, true)},`)
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
