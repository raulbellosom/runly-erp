import { toPascal, moduleSlug } from './helpers.js'

export function generateApiIndex(config) {
  const slug = moduleSlug(config.key)
  const modulePascal = toPascal(slug)
  const entities = config.entities

  const imports = entities
    .map((e) => `import { create${toPascal(e.name)}Router } from './${e.name}-routes.js'`)
    .join('\n')

  const mounts = entities
    .map((e) => `  app.route('', create${toPascal(e.name)}Router({ prisma, requirePermission, moduleContext }))`)
    .join('\n')

  return `import { Hono } from 'hono'
${imports}

export default function create${modulePascal}Router({ prisma, requirePermission, moduleContext, cache = null }) {
  const app = new Hono()
${mounts}
  return app
}
`
}
