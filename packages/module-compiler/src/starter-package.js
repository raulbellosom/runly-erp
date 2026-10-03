// "Paquete base" for module authors who start in code or with an AI instead of
// the Builder: a complete, installable package (one sample entity, its
// TABLE/FORM/DETAIL/PAGE views, API, validators, a CUSTOM dashboard) plus the
// developer guide, AGENTS.md, the offline docs and the golden reference
// screens — exactly what the Builder's "Descargar ZIP" ships.
import { archiveModule } from './archive.js'
import { compileModule } from './compiler.js'
import { developerDocFiles } from './developer-docs.js'
import { goldenScreenFiles } from './templates/golden-screens.js'

export const STARTER_KEY_RE = /^custom\.[a-z][a-z0-9]{1,39}$/

export class StarterPackageError extends Error {
  constructor(message, details = null) {
    super(message)
    this.name = 'StarterPackageError'
    this.status = 400
    this.details = details
  }
}

export function createStarterDefinition({ key, name }) {
  if (!STARTER_KEY_RE.test(String(key ?? ''))) {
    throw new StarterPackageError('La clave debe ser custom.<nombre> en minúsculas, sin espacios ni guiones (por ejemplo custom.visitas).')
  }
  const label = String(name ?? '').trim() || key.split('.').pop().replace(/^\w/, (c) => c.toUpperCase())
  return {
    schemaVersion: 1,
    key,
    name: label,
    version: '0.1.0',
    description: `Módulo ${label}.`,
    icon: 'Box',
    color: '#2563EB',
    preset: 'crud-custom',
    pwa: { shortName: label.slice(0, 14), startPath: '/registros' },
    entities: [{
      key: 'registro',
      label: 'Registro',
      pluralLabel: 'Registros',
      fields: [
        { key: 'nombre', type: 'text', label: 'Nombre', required: true },
        { key: 'descripcion', type: 'textarea', label: 'Descripción' },
        { key: 'fecha', type: 'date', label: 'Fecha' },
        { key: 'estado', type: 'select', label: 'Estado', required: true, options: [{ value: 'ACTIVO', label: 'Activo' }, { value: 'CERRADO', label: 'Cerrado' }] },
        { key: 'monto', type: 'decimal', label: 'Monto' },
      ],
    }],
  }
}

export async function buildStarterPackage({ key, name }) {
  let compiled
  try {
    compiled = compileModule(createStarterDefinition({ key, name }))
  } catch (error) {
    if (error instanceof StarterPackageError) throw error
    const messages = error?.diagnostics?.errors?.map((entry) => entry.message) ?? []
    throw new StarterPackageError(`No se pudo generar el paquete base${messages.length ? `: ${messages.join(' ')}` : '.'}`, messages)
  }
  const files = [...compiled.files, ...developerDocFiles(), ...goldenScreenFiles(compiled.definition)]
  const buffer = await archiveModule({ ...compiled, files })
  return { buffer, filename: `${key}-paquete-base.zip`, files: files.map((file) => file.path) }
}
