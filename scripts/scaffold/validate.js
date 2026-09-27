import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createDefinitionFromScaffoldConfig, validateModuleDefinition } from '../../packages/module-compiler/src/index.js'

export function validateConfig(config) {
  if (!config || typeof config !== 'object') return ['La configuracion debe ser un objeto JSON valido.']
  const result = validateModuleDefinition(createDefinitionFromScaffoldConfig(config))
  return result.errors.map((error) => {
    if (error.code === 'INVALID_MODULE_KEY') return `key "${config.key}" tiene formato invalido.`
    if (error.code === 'RESERVED_MODULE_NAMESPACE') return 'El prefijo del modulo esta reservado.'
    if (error.code === 'DUPLICATE_ENTITY_KEY') return `${error.path}: nombre de entidad duplicado.`
    if (error.code === 'DUPLICATE_FIELD_KEY') return `${error.path}: nombre de campo duplicado.`
    if (error.code === 'INVALID_FIELD_KEY' && /reserved/i.test(error.message)) return `${error.path}: campo reservado.`
    if (error.code === 'MISSING_RELATION_TARGET') return `${error.path}: relation requiere relatedModel.`
    return `${error.path}: ${error.message}`
  })
}

export function validateModuleDirectory(moduleKey, repoRoot) {
  const modulePath = resolve(repoRoot, 'modules', 'custom', moduleKey)
  return existsSync(modulePath) ? modulePath : null
}
