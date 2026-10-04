// "Preparar para IA externa" (spec 2026-10-03-rme3-module-platform-v2 §5 goal 9,
// plan Task 5.3): a ready-to-paste Spanish prompt describing the module as it
// is today, what to read inside the ZIP, the rules that must not be broken and
// what to hand back. The user downloads the ZIP next to it and adds the change
// they want where the placeholder says.
import { EXTERNAL_RELATION_TARGETS } from '@runly/module-compiler'

const keyOf = (item) => item?.key ?? item?.name

function bumpMinor(version) {
  const [major, minor] = String(version ?? '0.1.0').split('.').map((part) => Number.parseInt(part, 10) || 0)
  return `${major}.${minor + 1}.0`
}

function describeField(field, entities) {
  const parts = [`\`${keyOf(field)}\` (${field.type})`, field.label]
  if (field.required) parts.push('obligatorio')
  if (field.type === 'relation') {
    const external = field.targetExternal ? EXTERNAL_RELATION_TARGETS[field.targetExternal] : null
    const local = entities.find((entity) => keyOf(entity) === field.targetEntity)
    parts.push(`→ ${external ? `${external.moduleName} · ${external.label}` : local ? `entidad ${local.label}` : field.targetEntity ?? field.targetExternal}`)
  }
  if (Array.isArray(field.options) && field.options.length) {
    parts.push(`opciones: ${field.options.map((option) => (typeof option === 'object' ? option.value : option)).join(', ')}`)
  }
  return `  - ${parts.filter(Boolean).join(' · ')}`
}

export function buildExternalAiPrompt(definition) {
  const entities = definition?.entities ?? []
  const lines = []
  lines.push(`Vas a modificar el módulo **${definition.name}** de Runly ERP (clave \`${definition.key}\`, versión ${definition.version ?? '0.1.0'}).`)
  lines.push('Te adjunto su ZIP completo. Devuélveme el ZIP actualizado.')
  lines.push('')
  lines.push('## Lo que quiero que hagas')
  lines.push('<<Describe aquí el cambio: una pantalla nueva, un reporte, un cálculo, una acción...>>')
  lines.push('')
  lines.push('## Cómo es el módulo hoy')
  for (const entity of entities) {
    lines.push(`- Entidad **${entity.label}** (\`${keyOf(entity)}\`):`)
    for (const field of entity.fields ?? []) lines.push(describeField(field, entities))
  }
  for (const view of (definition.views ?? []).filter((item) => !item.generated)) {
    lines.push(`- Vista ${view.kind}${view.title ? ` "${view.title}"` : ''}${view.entity ? ` de \`${view.entity}\`` : ''}`)
  }
  for (const connection of definition.connections ?? []) {
    const target = EXTERNAL_RELATION_TARGETS[connection.target]
    lines.push(`- Conexión "${connection.label}": ${connection.kind === 'fields' ? 'campos extra' : 'registros relacionados'} en ${target ? `${target.moduleName} · ${target.label}` : connection.target}`)
  }
  for (const link of definition.publicLinks ?? []) lines.push(`- Página pública "${link.title}" (${link.mode === 'submit' ? 'formulario' : 'ficha'})`)
  lines.push('')
  lines.push('## Antes de escribir código, lee dentro del ZIP')
  lines.push('1. `AGENTS.md` (reglas del paquete) y `docs/` (guía para desarrolladores).')
  lines.push('2. `docs/componentes.md`: componentes de interfaz disponibles y sus props. Úsalos siempre; no uses controles HTML nativos.')
  lines.push('3. `docs/iconos.md`: nombres de iconos válidos.')
  lines.push('4. `docs/ejemplos/`: pantallas de referencia (listado, detalle, formulario, tablero). Copia su estructura.')
  lines.push('')
  lines.push('## Reglas que no se pueden romper')
  lines.push(`- La clave del módulo sigue siendo \`${definition.key}\`. Sube la versión en \`module.manifest.js\` a ${bumpMinor(definition.version)} o mayor.`)
  lines.push('- Las tablas solo cambian en `models/` con `defineModel`. Cada campo conserva su `id`; para renombrar un campo cambia su `name` y deja el mismo `id`. Para transformar datos usa `migrations/NNN-descripcion.js`.')
  lines.push('- En `api/`, SQL solo con `prisma.$queryRaw` y plantillas etiquetadas, siempre filtrando por la empresa activa; los ids los genera la base (`INSERT … RETURNING *`). Nada de borrar filas: se desactivan con `enabled = false`.')
  lines.push('- Pantallas React en `components/`, registradas como vistas `views/<nombre>.custom.js`. Todo el texto visible en español, sin emojis, con los colores del tema (sin colores fijos).')
  lines.push('- No edites `.module-definition.json` ni los archivos generados por el Constructor salvo que el cambio lo requiera; si los cambias, el proyecto pasará a modo desarrollador.')
  lines.push('')
  lines.push('## Qué me devuelves')
  lines.push('- El ZIP completo con la misma estructura, listo para Módulos > Subir actualización.')
  lines.push('- Un resumen breve de los cambios y, si cambiaste tablas, qué campos se agregan, renombran o archivan.')
  return lines.join('\n')
}
