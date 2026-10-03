export {
  assertValidModuleDefinition,
  createCrudCustomDefinition,
  createCrudDefinition,
  createDefinitionFromScaffoldConfig,
  CURRENT_MODULE_DEFINITION_SCHEMA_VERSION,
  normalizeModuleDefinition,
  upgradeModuleDefinition,
  validateModuleDefinition,
} from './definition.js'
export { compileModule } from './compiler.js'
export { archiveModule } from './archive.js'
export { DEVELOPER_DOCS_DIR, developerDocFiles, isDeveloperDocPath } from './developer-docs.js'
export { DEFINITION_FILE, EXTENSIONS_MAX_BYTES, hasExtensions, isExtensionFilePath } from './extensions.js'
import { classifyPackage } from './extensions.js'
import { compileModule } from './compiler.js'

// Does a package differ from what the Builder generates only by code
// extensions (React screens)? See extensions.js#classifyPackage.
export function classifyModulePackage({ key, files, manifest }) {
  return classifyPackage({ key, files, manifest, compile: compileModule })
}
export { EXTERNAL_RELATION_TARGETS, externalTarget, isExternalRelation } from './external-relations.js'
export { reviewComponentSources } from './design-review.js'
export { EXAMPLES_DIR, goldenScreenFiles } from './templates/golden-screens.js'
