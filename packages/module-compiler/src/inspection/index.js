import { createHash } from 'node:crypto'
import {
  defineRunlyModule, defineModel, defineView, definePage,
  validateConnectionsAgainstModels, normalizeConnection,
} from '@runly/module-engine/browser'
import { RME3_CAPABILITIES } from '../contracts.js'
import { EXTERNAL_RELATION_TARGETS } from '../external-relations.js'
import { compileModule } from '../compiler.js'
import { DEFINITION_FILE } from '../extensions.js'
import { isDeveloperDocPath } from '../developer-doc-paths.js'
import { readZip, safePackagePath } from './zip.js'
import { parseDeclaration, parseDataJson } from './declarations.js'
import { INSPECTION_VERSION, inspectionLimits, InspectionError } from './limits.js'
export { DEFAULT_INSPECTION_LIMITS, INSPECTION_VERSION } from './limits.js'

const keyPattern = /^[a-z][a-z0-9]*\.[a-z][a-z0-9_]*$/
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const permissionPattern = /^[a-z][a-zA-Z0-9_]*(?:\.[a-z][a-zA-Z0-9_]*)+$/
const decoder = new TextDecoder('utf-8', { fatal: true })

// Synchronous, bounded inspection of owned bytes. Put this in a supervised
// process for wall-time/heap enforcement in the future upload worker.
// No imports, eval, vm, subprocess, extraction or JS resolution from the ZIP.
export function inspectModuleZip(bytes, { limits: requestedLimits, expectedKey, expectedVersion, capabilities = RME3_CAPABILITIES } = {}) {
  const limits = inspectionLimits(requestedLimits)
  const diagnostics = [], models = [], views = [], pages = []
  let manifest = null, definition = null, generatedMatch = null, archive
  const report = {
    schemaVersion: INSPECTION_VERSION, evidence: 'static', executesUserCode: false,
    contracts: { engineVersion: RME3_CAPABILITIES.engine.engineVersion, engineContractVersion: RME3_CAPABILITIES.engine.schemaVersion, compilerVersion: RME3_CAPABILITIES.compiler.compilerVersion,
      compilerContractVersion: RME3_CAPABILITIES.compiler.schemaVersion, runtimeId: RME3_CAPABILITIES.runtime.runtimeId,
      runtimeContractVersion: RME3_CAPABILITIES.runtime.schemaVersion, capabilitiesVersion: RME3_CAPABILITIES.schemaVersion },
    sha256: null, size: bytes?.byteLength ?? null,
  }
  const add = (code, path, message, severity = 'error', details = {}) => diagnostics.push({ code, path, severity, message, details })
  const attempt = (path, action) => {
    try { return action() } catch (error) {
      if (error instanceof InspectionError) diagnostics.push(error.diagnostic)
      else add('RME3_CONTRACT_INVALID', path, 'Declaración incompatible con el contrato RME3.', 'error', { reason: String(error.message).slice(0, 500) })
      return null
    }
  }
  try {
    if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) throw new TypeError('ZIP must be bytes')
    // Hash even malformed archives, but never copy/hash over-budget inputs.
    const snapshot = bytes.byteLength <= limits.zipBytes ? Buffer.from(bytes) : bytes
    if (snapshot.byteLength <= limits.zipBytes) report.sha256 = createHash('sha256').update(snapshot).digest('hex')
    archive = readZip(snapshot, limits)
    report.expandedBytes = archive.expandedBytes
    report.entries = archive.entries
    const files = archive.files
    const text = (path) => {
      if (!files.has(path)) throw new InspectionError('PACKAGE_FILE_MISSING', path, 'Falta un archivo declarado.')
      try { return decoder.decode(files.get(path)) } catch { throw new InspectionError('PACKAGE_TEXT_INVALID', path, 'El archivo debe ser UTF-8 válido.') }
    }
    if (capabilities.schemaVersion !== RME3_CAPABILITIES.schemaVersion || capabilities.runtime?.runtimeId !== RME3_CAPABILITIES.runtime.runtimeId) {
      add('CAPABILITY_CONTRACT_UNSUPPORTED', '', 'La versión de capacidades/runtime no está soportada por este inspector.')
    }
    const parsed = attempt('module.manifest.js', () => parseDeclaration(text('module.manifest.js'), 'module.manifest.js', ['defineRunlyModule', 'defineAtlasModule'], limits))
    if (parsed) manifest = attempt('module.manifest.js', () => defineRunlyModule(parsed.value))
    if (manifest) {
      if (!keyPattern.test(manifest.key)) add('MODULE_KEY_INVALID', 'manifest.key', 'Key requiere namespace.slug en minúsculas.')
      if (!versionPattern.test(manifest.version)) add('MODULE_VERSION_UNSUPPORTED', 'manifest.version', 'Esta release admite versiones x.y.z canónicas sin prerelease.')
      if (expectedKey !== undefined && manifest.key !== expectedKey) add('PACKAGE_IDENTITY_MISMATCH', 'manifest.key', 'Key del ZIP distinta de la release esperada.')
      if (expectedVersion !== undefined && manifest.version !== expectedVersion) add('PACKAGE_IDENTITY_MISMATCH', 'manifest.version', 'Versión del ZIP distinta de la release esperada.')
      if (manifest.pwa?.legacyDerived) add('LEGACY_PWA_DERIVED', 'manifest.pwa', 'Identidad PWA legacy derivada con el declarador compartido.', 'warning')
      if (!capabilities.engine.moduleKinds.includes(manifest.kind)) add('MODULE_KIND_UNSUPPORTED', 'manifest.kind', 'Tipo de módulo no soportado.')
      const dependencies = new Set()
      if (!Array.isArray(manifest.dependencies)) add('DEPENDENCIES_INVALID', 'manifest.dependencies', 'dependencies debe ser array.')
      else for (const [i, dep] of manifest.dependencies.entries()) {
        const key = typeof dep === 'string' ? dep : dep?.key, path = `manifest.dependencies[${i}]`
        if (!keyPattern.test(key ?? '') || key === manifest.key || dependencies.has(key)) add('DEPENDENCY_INVALID', path, 'Dependencia inválida, duplicada o autorreferente.')
        if (dep && typeof dep === 'object' && dep.version !== undefined) add('DEPENDENCY_RANGE_UNSUPPORTED', path, 'El instalador v1 no resuelve rangos/versiones de dependencias.')
        dependencies.add(key)
      }
      const permissions = new Set()
      for (const [i, p] of manifest.permissions.entries()) {
        if (!permissionPattern.test(p.key) || permissions.has(p.key)) add('PERMISSION_INVALID', `manifest.permissions[${i}]`, 'Permiso inválido o duplicado.')
        permissions.add(p.key)
      }
      for (const [i, n] of manifest.navigation.entries()) {
        if (!permissions.has(n.permissionKey)) add('PERMISSION_UNDECLARED', `manifest.navigation[${i}].permissionKey`, 'El permiso de navegación no está declarado.')
        if (!safeRoute(n.path, `/app/m/${manifest.key}`)) add('ROUTE_OUTSIDE_MODULE', `manifest.navigation[${i}].path`, 'La navegación debe permanecer dentro del módulo.')
      }
      const declared = new Set(['module.manifest.js'])
      const loadDeclarations = (list, prefix, names, normalize, destination) => {
        if (!Array.isArray(list)) { add('DECLARATION_PATHS_INVALID', `manifest.${prefix}`, 'Paths declarados deben ser array.'); return }
        const keys = new Set()
        for (const file of list) {
          attempt(`manifest.${prefix}`, () => {
            if (typeof file !== 'string') throw new InspectionError('DECLARATION_PATH_INVALID', `manifest.${prefix}`, 'Path debe ser string.')
            const path = safePackagePath(file.replace(/^\.\//, ''))
            if (!path.startsWith(`${prefix}/`) || !path.endsWith('.js') || declared.has(path)) throw new InspectionError('DECLARATION_PATH_INVALID', path, 'Declaración fuera de carpeta, extensión o path duplicado.')
            declared.add(path)
            const contract = parseDeclaration(text(path), path, names, limits)
            const value = normalize(contract)
            if (keys.has(value.key)) add('DECLARATION_KEY_DUPLICATE', path, 'Key de declaración duplicada.')
            keys.add(value.key)
            destination(contract, value, path)
          })
        }
      }
      const slug = manifest.key.split('.').pop()
      loadDeclarations(manifest.models === undefined ? [] : manifest.models, 'models', ['defineModel'], (p) => defineModel(p.value), (_, value, path) => {
        if (!String(value.tableName).startsWith(`${slug}_`) || (value.name !== undefined && !String(value.name).startsWith(`${slug}.`))) add('MODEL_OWNERSHIP_INVALID', path, 'Tabla/nombre de modelo no pertenece al slug del módulo.')
        const fields = new Set()
        for (const field of value.fields) {
          if (fields.has(field.name)) add('MODEL_FIELD_DUPLICATE', path, 'Campo duplicado.')
          fields.add(field.name)
          if (!capabilities.engine.fieldTypes.includes(field.type)) add('FIELD_CAPABILITY_UNSUPPORTED', path, 'Tipo de campo no soportado por runtime.')
        }
        if (models.some((m) => m.tableName === value.tableName)) add('MODEL_TABLE_DUPLICATE', path, 'Tabla repetida.')
        models.push(value)
      })
      loadDeclarations(manifest.views === undefined ? [] : manifest.views, 'views', ['defineView', 'definePage'], (p) => p.declarator === 'definePage' ? definePage(p.value) : defineView(p.value), (contract, value, path) => {
        if (!value.key.startsWith(`${slug}.`)) add('VIEW_OWNERSHIP_INVALID', path, 'Key de vista no pertenece al módulo.')
        if (contract.declarator === 'definePage') pages.push(value)
        else {
          if (!capabilities.engine.blueprintKinds.includes(value.kind)) add('VIEW_CAPABILITY_UNSUPPORTED', path, 'Kind no soportado por runtime.')
          if (value.kind === 'CUSTOM') {
            const sharedPublic = value.schema.public === true && capabilities.runtime.publicComponents.includes(value.schema.component)
            if (!sharedPublic && !value.schema.component.startsWith(`${manifest.key}:`)) add('CUSTOM_COMPONENT_NAMESPACE', path, 'Componente CUSTOM debe pertenecer al módulo o al contrato público compartido.')
            add('CUSTOM_NOT_EXECUTED', path, 'CUSTOM descrito estáticamente; no compilado ni visualizado en esta fase.', 'warning')
          }
          views.push(value)
        }
        const route = value.path ?? value.schema?.path
        if (route && !safeRoute(route, value.schema?.public === true ? `/p/${slug}` : `/app/m/${manifest.key}`)) add('ROUTE_OUTSIDE_MODULE', path, 'Ruta de vista fuera del módulo.')
        const permission = value.schema?.permissionKey
        if (permission && !permissions.has(permission)) add('PERMISSION_UNDECLARED', path, 'Permiso de vista no declarado.')
      })
      for (const page of pages) if (page.view && !views.some((v) => v.key === page.view)) add('PAGE_VIEW_MISSING', page.key, 'Página apunta a vista inexistente.')
      for (const path of files.keys()) if (/^(models|views)\/.*\.js$/.test(path) && !declared.has(path)) add('UNDECLARED_CONTRACT_FILE', path, 'Declaración no referenciada por el manifiesto.')
      for (const [key, services] of Object.entries(manifest.consumes ?? {})) {
        if (!dependencies.has(key)) add('INTEGRATION_DEPENDENCY_MISSING', `manifest.consumes.${key}`, 'Servicio requiere dependencia declarada.')
        for (const service of services) if (!capabilities.services.includes(`${key}:${service}`)) add('SERVICE_CAPABILITY_UNSUPPORTED', `manifest.consumes.${key}`, 'Servicio no está en el contrato disponible.', 'error', { service })
      }
      for (const event of manifest.events?.subscribes ?? []) if (!capabilities.events.includes(event)) add('EVENT_CAPABILITY_UNSUPPORTED', 'manifest.events.subscribes', 'Evento no está en el contrato disponible.', 'error', { event })
      for (const c of manifest.connections ?? []) {
        if (!capabilities.connectionTargets.includes(c.target)) add('CONNECTION_CAPABILITY_UNSUPPORTED', `manifest.connections.${c.key}`, 'Target no soportado.')
        const target = EXTERNAL_RELATION_TARGETS[c.target]
        if (target && !dependencies.has(target.module)) add('INTEGRATION_DEPENDENCY_MISSING', `manifest.connections.${c.key}`, 'Target requiere dependencia declarada.')
      }
      for (const message of validateConnectionsAgainstModels((manifest.connections ?? []).map(normalizeConnection), models)) add('CONNECTION_MODEL_INVALID', 'manifest.connections', message)
      for (const resource of manifest.publicResources ?? []) {
        if (!views.some((v) => v.key === resource.view && v.kind === 'CUSTOM' && v.schema.public === true)) add('PUBLIC_VIEW_MISSING', 'manifest.publicResources', 'Recurso público requiere una vista CUSTOM pública declarada.')
        if (resource.entity && !models.some((m) => m.key === resource.entity)) add('PUBLIC_MODEL_MISSING', 'manifest.publicResources', 'Entidad pública no declarada en modelos.')
      }
      if (manifest.events && Object.keys(manifest.events).some((key) => key !== 'subscribes')) add('EVENT_DECLARATION_UNSUPPORTED', 'manifest.events', 'Solo events.subscribes pertenece al contrato actual.')
      const tables = new Set(models.map((m) => m.tableName))
      for (const table of manifest.lifecycle?.ownedTables ?? []) if (!tables.has(table)) add('LIFECYCLE_TABLE_UNDECLARED', 'manifest.lifecycle.ownedTables', 'Lifecycle reclama tabla no declarada por este módulo.', 'error', { table })
      for (const migration of manifest.migrations ?? []) {
        attempt('manifest.migrations', () => {
          const path = safePackagePath(migration.path.replace(/^\.\//, ''))
          if (!files.has(path)) throw new InspectionError('PACKAGE_FILE_MISSING', path, 'Falta una migración declarada.')
          if (createHash('sha256').update(files.get(path)).digest('hex') !== migration.checksum.toLowerCase()) add('MIGRATION_CHECKSUM_MISMATCH', path, 'Checksum de migración no coincide con sus bytes.')
          add('MIGRATION_NOT_EXECUTED', path, 'Migración no ejecutada ni certificada.', 'info')
        })
      }
      if (views.some((v) => v.kind === 'CUSTOM' && !capabilities.runtime.publicComponents.includes(v.schema.component)) && !files.has('components/index.js')) add('CUSTOM_COMPONENTS_MISSING', 'components/index.js', 'CUSTOM requiere entry del registro de componentes.')
      for (const path of files.keys()) if (/^(api|migrations)\//.test(path)) add('BACKEND_NOT_EXECUTED', path, 'Código/SQL backend no ejecutado ni certificado por la inspección.', 'info')
    }
    if (files.has(DEFINITION_FILE)) {
      definition = attempt(DEFINITION_FILE, () => parseDataJson(text(DEFINITION_FILE), DEFINITION_FILE, limits))
      if (definition && manifest) {
        if (definition.key !== manifest.key || definition.version !== manifest.version) add('DEFINITION_IDENTITY_MISMATCH', DEFINITION_FILE, 'Identidad de definición y manifiesto difieren.')
        const compiled = attempt(DEFINITION_FILE, () => compileModule(definition))
        if (compiled) {
          generatedMatch = true
          // Reuse the existing compiler; compare its actual output, not just the
          // JSON's assertion. Freely editable docs never certify executable code.
          const expected = new Set(compiled.files.map((f) => f.path))
          const editable = (p) => isDeveloperDocPath(p) || /\.md$/.test(p) || p === DEFINITION_FILE
          for (const file of compiled.files) {
            if (editable(file.path)) continue
            if (!files.has(file.path) || text(file.path).replace(/\r\n/g, '\n') !== file.content.replace(/\r\n/g, '\n')) {
              generatedMatch = false
              add('DEFINITION_SOURCE_MISMATCH', file.path, 'Archivo no coincide con la salida de la definición y compiler fijado.')
            }
          }
          for (const p of files.keys()) if (!expected.has(p) && !editable(p)) {
            generatedMatch = false
            add('DEFINITION_SOURCE_MISMATCH', p, 'Archivo extra no está emitido por la definición.')
          }
        }
      }
    }
    add('STATIC_EVIDENCE_ONLY', '', 'La inspección valida contratos; no prueba seguridad del JavaScript ni integración ERP/Playground.', 'info')
  } catch (error) {
    if (error instanceof InspectionError) diagnostics.push(error.diagnostic)
    else if (error instanceof TypeError && !archive) throw error
    else add('PACKAGE_STRUCTURE_INVALID', '', 'Estructura del paquete no analizable con este contrato.')
  }
  return { ...report, valid: !diagnostics.some((d) => d.severity === 'error'), diagnostics,
    manifest, models, views, pages, definition, generatedMatch,
    files: archive ? [...archive.files].map(([path, data]) => ({ path, size: data.length })) : [] }
}

function safeRoute(route, prefix) {
  return typeof route === 'string' && (route === prefix || route.startsWith(`${prefix}/`)) &&
    !/[\\?#\x00-\x20%]/.test(route) && !route.split('/').some((part) => part === '.' || part === '..')
}
export { parseDeclaration } from './declarations.js'
