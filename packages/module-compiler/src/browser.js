// No filesystem, ZIP implementation, Node crypto or ERP application imports.
export * from './definition.js'
export { assignFieldIds, uuidv7 } from './field-ids.js'
export { EXTERNAL_RELATION_TARGETS, externalTarget, connectionTarget } from './external-relations.js'
export { DEFINITION_FILE, EXTENSIONS_MAX_BYTES, hasExtensions, isExtensionFilePath } from './extensions.js'
export * from './contracts.js'
