// Validation for the optional manifest `publicResources` section (spec:
// docs/superpowers/specs/2026-09-28-module-public-links-design.md).
//
//   publicResources: [{ key: 'encuesta.responder', entity: 'encuesta', mode: 'submit',
//     view: 'encuestas.responder-publica', title: 'Responder encuesta',
//     managePermission: 'encuestas.encuesta.update' }]
//
// Only shape and permission checks live here; the manifest does not carry the
// module's views/models, so `view` is resolved when a link is created.

export const PUBLIC_RESOURCE_MODES = Object.freeze(['view', 'submit'])
export const MAX_PUBLIC_RESOURCES = 20

const RESOURCE_KEY_RE = /^[a-z][a-z0-9_.-]{1,63}$/
const REF_RE = /^[a-zA-Z][a-zA-Z0-9_.-]{0,127}$/

export function validatePublicResources(manifest, errors) {
  const list = manifest?.publicResources
  if (list === undefined) return
  if (!Array.isArray(list)) { errors.push('publicResources must be an array'); return }
  if (list.length > MAX_PUBLIC_RESOURCES) {
    errors.push(`publicResources must declare at most ${MAX_PUBLIC_RESOURCES} entries`)
  }
  const permissionKeys = new Set(
    (Array.isArray(manifest.permissions) ? manifest.permissions : []).map((p) => p?.key),
  )
  const seen = new Set()
  list.forEach((entry, i) => {
    const at = `publicResources[${i}]`
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) { errors.push(`${at} must be an object`); return }
    if (typeof entry.key !== 'string' || !RESOURCE_KEY_RE.test(entry.key)) {
      errors.push(`${at}.key must match ${RESOURCE_KEY_RE}`)
    } else if (seen.has(entry.key)) {
      errors.push(`${at}.key "${entry.key}" is duplicated`)
    } else {
      seen.add(entry.key)
    }
    if (!PUBLIC_RESOURCE_MODES.includes(entry.mode)) {
      errors.push(`${at}.mode must be one of: ${PUBLIC_RESOURCE_MODES.join(', ')}`)
    }
    if (typeof entry.view !== 'string' || !REF_RE.test(entry.view)) {
      errors.push(`${at}.view must be the key of a public CUSTOM view of this module`)
    }
    if (entry.entity !== undefined && (typeof entry.entity !== 'string' || !REF_RE.test(entry.entity))) {
      errors.push(`${at}.entity must be a model key`)
    }
    if (typeof entry.title !== 'string' || !entry.title.trim()) {
      errors.push(`${at}.title is required`)
    }
    if (typeof entry.managePermission !== 'string' || !permissionKeys.has(entry.managePermission)) {
      errors.push(`${at}.managePermission must be a permission declared by this module`)
    }
  })
}

export function findPublicResource(manifest, resourceKey) {
  const list = Array.isArray(manifest?.publicResources) ? manifest.publicResources : []
  return list.find((r) => r?.key === resourceKey) ?? null
}
