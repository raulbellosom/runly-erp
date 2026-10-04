// Code extensions carried by a Builder module: hand-written React screens
// (components/**) and CUSTOM views (views/<name>.custom.js) with their menu
// entries. The Builder stores them in `definition.extensions` and re-emits
// them on every compile. `classifyPackage` tells whether an uploaded/installed
// package differs from what the Builder generates only by such extensions.
// See docs/superpowers/specs/2026-09-28-rme3-builder-code-extensions-design.md.

import { isDeveloperDocPath } from './developer-doc-paths.js'

export const EXTENSIONS_MAX_BYTES = 1.5 * 1024 * 1024
export const DEFINITION_FILE = '.module-definition.json'
const COMPONENT_FILE = /^components\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.(?:jsx?|css|json|svg)$/
const CUSTOM_VIEW_FILE = /^views\/[a-z0-9][a-z0-9_-]*\.custom\.js$/
const UNSAFE_TEXT = /[\u0000]/

function diagnostic(path, code, message) {
  return { path, code, message, severity: 'error' }
}

export function isExtensionFilePath(filePath) {
  const value = String(filePath ?? '')
  return !value.includes('..') && (COMPONENT_FILE.test(value) || CUSTOM_VIEW_FILE.test(value))
}

export function isCustomViewFile(filePath) {
  return CUSTOM_VIEW_FILE.test(String(filePath ?? ''))
}

export function hasExtensions(extensions) {
  return Boolean(extensions?.files?.length || extensions?.views?.length || extensions?.navigation?.length)
}

export function validateExtensions(definition, permissionKeys, errors) {
  const extensions = definition.extensions
  if (extensions === undefined || extensions === null) return
  const base = 'extensions'
  if (typeof extensions !== 'object' || Array.isArray(extensions)) { errors.push(diagnostic(base, 'EXTENSIONS_INVALID', 'extensions must be an object.')); return }
  const paths = new Set()
  let bytes = 0
  ;(extensions.files ?? []).forEach((file, index) => {
    const path = `${base}.files[${index}]`
    if (!isExtensionFilePath(file?.path)) errors.push(diagnostic(`${path}.path`, 'EXTENSION_PATH_NOT_ALLOWED', `"${file?.path}" is not an allowed extension path (components/** or views/<name>.custom.js).`))
    if (paths.has(file?.path)) errors.push(diagnostic(`${path}.path`, 'EXTENSION_DUPLICATE_PATH', `Duplicate extension file "${file?.path}".`))
    paths.add(file?.path)
    if (typeof file?.content !== 'string' || UNSAFE_TEXT.test(file.content)) errors.push(diagnostic(`${path}.content`, 'EXTENSION_NOT_TEXT', `"${file?.path}" must be a text file.`))
    else bytes += new TextEncoder().encode(file.content).byteLength
  })
  if (bytes > EXTENSIONS_MAX_BYTES) errors.push(diagnostic(`${base}.files`, 'EXTENSIONS_TOO_LARGE', 'Code extensions exceed 1.5 MB.'))
  ;(extensions.views ?? []).forEach((view, index) => {
    if (!isCustomViewFile(view?.file) || !paths.has(view.file)) errors.push(diagnostic(`${base}.views[${index}].file`, 'EXTENSION_VIEW_NOT_FOUND', `View "${view?.file}" must be a views/<name>.custom.js extension file.`))
  })
  ;(extensions.navigation ?? []).forEach((item, index) => {
    const path = `${base}.navigation[${index}]`
    if (!String(item?.path ?? '').startsWith(`/app/m/${definition.key}/`) || String(item?.path).includes('..')) errors.push(diagnostic(`${path}.path`, 'UNSAFE_ROUTE_PATH', 'Extension navigation must stay inside the module.'))
    if (!String(item?.label ?? '').trim()) errors.push(diagnostic(`${path}.label`, 'REQUIRED', 'Extension navigation needs a label.'))
    if (item?.permissionKey && !permissionKeys.has(item.permissionKey)) errors.push(diagnostic(`${path}.permissionKey`, 'NAVIGATION_PERMISSION_NOT_FOUND', `Permission "${item.permissionKey}" is not declared by the module.`))
  })
}

const eol = (text) => String(text ?? '').replace(/\r\n/g, '\n')
const stripDot = (value) => String(value ?? '').replace(/^\.\//, '')
// Documentation files may be edited freely (e.g. by an AI assistant).
const IGNORED_FILES = new Set([DEFINITION_FILE, 'GUIA_DESARROLLO_RUNLY.md', 'AGENTS.md'])
const IGNORED = { has: (path) => IGNORED_FILES.has(path) || isDeveloperDocPath(path) }

// files: [{ path, content }] (text), manifest: the package's loaded manifest
// object. `compile` is compileModule (injected to avoid a circular import).
export function classifyPackage({ key, files, manifest, compile }) {
  const byPath = new Map(files.map((file) => [file.path, file.content]))
  let embedded
  try {
    embedded = JSON.parse(byPath.get(DEFINITION_FILE) ?? '')
  } catch {
    return { managed: false, reason: 'El paquete no trae la definición del Constructor (.module-definition.json).', foreign: [], extensions: null }
  }
  if (embedded?.key !== key) return { managed: false, reason: 'La definición del paquete es de otro módulo.', foreign: [], extensions: null }
  let compiled
  try {
    const withoutExtensions = { ...embedded }
    delete withoutExtensions.extensions
    compiled = compile(withoutExtensions)
  } catch {
    return { managed: false, reason: 'La definición del paquete no es válida para el Constructor.', foreign: [], extensions: null }
  }
  const generated = new Map(compiled.files.map((file) => [file.path, file.content]))
  const foreign = []
  const extensionFiles = []
  for (const [path, content] of byPath) {
    if (IGNORED.has(path) || path === 'module.manifest.js') continue
    if (generated.has(path)) {
      if (eol(generated.get(path)) !== eol(content)) foreign.push({ path, reason: 'modificado' })
    } else if (isExtensionFilePath(path)) {
      extensionFiles.push({ path, content: eol(content) })
    } else {
      foreign.push({ path, reason: 'agregado' })
    }
  }
  for (const path of generated.keys()) {
    if (!IGNORED.has(path) && path !== 'module.manifest.js' && !byPath.has(path)) foreign.push({ path, reason: 'eliminado' })
  }

  const expectedViews = [...generated.keys()].filter((path) => path.startsWith('views/'))
  const manifestViews = (manifest?.views ?? []).map(stripDot)
  const extensionViews = manifestViews.filter((path) => !expectedViews.includes(path))
  for (const path of extensionViews) {
    if (!isCustomViewFile(path) || !extensionFiles.some((file) => file.path === path)) foreign.push({ path: 'module.manifest.js', reason: `vista ${path} no es una pantalla personalizada` })
  }
  if (expectedViews.some((path) => !manifestViews.includes(path))) foreign.push({ path: 'module.manifest.js', reason: 'faltan vistas generadas' })
  const expectedModels = [...generated.keys()].filter((path) => path.startsWith('models/')).sort()
  const manifestModels = (manifest?.models ?? []).map(stripDot).sort()
  if (JSON.stringify(expectedModels) !== JSON.stringify(manifestModels)) foreign.push({ path: 'module.manifest.js', reason: 'modelos distintos' })
  const expectedPermissions = (compiled.definition.permissions ?? []).map((permission) => permission.key).sort()
  const manifestPermissions = (manifest?.permissions ?? []).map((permission) => permission.key).sort()
  if (JSON.stringify(expectedPermissions) !== JSON.stringify(manifestPermissions)) foreign.push({ path: 'module.manifest.js', reason: 'permisos distintos' })

  const expectedNav = new Set((compiled.definition.navigation ?? []).map((item) => item.path))
  const navigation = (manifest?.navigation ?? [])
    .filter((item) => !expectedNav.has(item.path) && item.path !== `/app/m/${key}/dashboard`)
    .map((item) => ({ label: item.label, path: item.path, icon: item.icon ?? null, permissionKey: item.permissionKey ?? null }))

  return {
    managed: true,
    embeddedDefinition: embedded,
    foreign,
    extensions: { files: extensionFiles, views: extensionViews.map((file) => ({ file })), navigation },
  }
}
