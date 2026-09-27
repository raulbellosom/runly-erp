import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { compileModule, createDefinitionFromScaffoldConfig } from '../../packages/module-compiler/src/index.js'

export function writeCompiledModule(compiledModule, destination) {
  const written = []
  for (const file of compiledModule.files) {
    const absolutePath = resolve(destination, file.path)
    mkdirSync(dirname(absolutePath), { recursive: true })
    writeFileSync(absolutePath, file.content, 'utf8')
    written.push(file.path)
  }
  return { outDir: destination, written }
}

export function writeModule(config, repoRoot) {
  const outDir = resolve(repoRoot, 'modules', 'custom', config.key)
  const compiled = compileModule(createDefinitionFromScaffoldConfig(config))
  return { ...writeCompiledModule(compiled, outDir), compiled }
}

export function applyDefaults(config) {
  return {
    ...config,
    schemaVersion: config.schemaVersion ?? 1,
    version: config.version || '0.1.0',
    description: config.description || '',
    preset: config.preset || 'crud',
    pwa: config.pwa ? { ...config.pwa } : null,
    entities: (config.entities || []).map((entity) => ({
      ...entity,
      softDelete: entity.softDelete !== false,
      companyScoped: entity.companyScoped !== false,
      labelPlural: entity.labelPlural || `${entity.label}s`,
      fields: (entity.fields || []).map((field) => ({ ...field })),
    })),
  }
}
