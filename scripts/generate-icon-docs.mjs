#!/usr/bin/env node
// Writes docs/developers/iconos.md from the shared icon library
// (packages/ui/src/lib/icon-library): curated categories with Spanish labels
// first, then every other lucide name. Module authors and external AIs pick
// icon names from it. Run after changing the catalog or upgrading lucide:
//   node scripts/generate-icon-docs.mjs
// then node scripts/generate-module-developer-docs.mjs.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ICON_CATEGORIES, allIconNames } from '../packages/ui/src/lib/icon-library/index.js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(repoRoot, 'docs/developers/iconos.md')

const pascal = (name) => name.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('')

export function buildIconDocs() {
  const curated = new Set()
  const sections = ICON_CATEGORIES.map((category) => {
    const rows = category.items.map((item) => {
      curated.add(item.name)
      return `| \`${pascal(item.name)}\` | \`${item.name}\` | ${item.label} |`
    })
    return [`### ${category.label}`, '', '| Componente | Nombre | Uso |', '|---|---|---|', ...rows, ''].join('\n')
  })
  const rest = allIconNames().filter((name) => !curated.has(name)).map(pascal)
  return [
    '---',
    'title: Iconos',
    'summary: Iconos de lucide-react disponibles en Runly, agrupados por uso con su nombre en español, y la lista completa de nombres.',
    'order: 2.6',
    '---',
    'Runly usa los iconos de [lucide](https://lucide.dev). Úsalos en títulos de sección, botones, estados vacíos, indicadores y en el menú del módulo; no uses emojis.',
    '',
    '```jsx',
    "import { Truck, FileText } from 'lucide-react'",
    '',
    '<CardTitle className="flex items-center gap-2"><Truck className="h-4 w-4 text-primary" /> Entregas</CardTitle>',
    '<StatCard label="Pendientes" value={7} icon={FileText} />   // StatCard y EmptyState reciben el componente, no <Icono />',
    '```',
    '',
    '- **En componentes React** importa el nombre en *PascalCase* (columna *Componente*).',
    '- **En `module.manifest.js`** (`navigation[].icon`) usa también el nombre en *PascalCase*: `icon: \'Truck\'`.',
    '- **Si el icono viene de datos**, guarda el nombre en *kebab-case* (columna *Nombre*) y dibújalo con `IconGlyph` de `@runly/ui`.',
    '',
    `Abajo están los ${curated.size} iconos recomendados por categoría y, al final, los ${rest.length} restantes.`,
    '',
    '## Recomendados por categoría',
    '',
    ...sections,
    '## Todos los demás',
    '',
    rest.map((name) => `\`${name}\``).join(' · '),
    '',
  ].join('\n')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(OUT, buildIconDocs())
  console.log(`iconos.md: ${ICON_CATEGORIES.length} categorías, ${allIconNames().length} iconos`)
}
