// Manifest `consumes` and `events` (spec 2026-10-03-rme3-module-platform-v2 §15.3):
//
//   consumes: { 'runly.inventory': ['items.read', 'items.search'] }
//   events: { subscribes: ['inventory.item.updated'] }
//
// Shape only: which services exist and which events are published is owned
// by the API (module-services/service-catalog.js, domain-events/events.js).

const MODULE_KEY_RE = /^[a-z][a-z0-9]*\.[a-z][a-z0-9_]*$/
const SERVICE_RE = /^[a-z][a-zA-Z]*\.[a-z][a-zA-Z]*$/
const EVENT_RE = /^[a-z]+\.[a-z_]+\.[a-z_]+$/
const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export function validateIntegrations(manifest, errors) {
  if (manifest?.consumes !== undefined) {
    if (!isPlainObject(manifest.consumes)) errors.push('consumes must be an object { moduleKey: [service, ...] }')
    else {
      for (const [moduleKey, services] of Object.entries(manifest.consumes)) {
        if (!MODULE_KEY_RE.test(moduleKey)) errors.push(`consumes: "${moduleKey}" is not a module key`)
        if (!Array.isArray(services) || !services.length) errors.push(`consumes.${moduleKey} must be a non-empty array`)
        else for (const service of services) if (!SERVICE_RE.test(String(service))) errors.push(`consumes.${moduleKey}: "${service}" must look like "items.read"`)
      }
    }
  }
  if (manifest?.events !== undefined) {
    if (!isPlainObject(manifest.events)) errors.push('events must be an object { subscribes: [...] }')
    else if (manifest.events.subscribes !== undefined) {
      if (!Array.isArray(manifest.events.subscribes)) errors.push('events.subscribes must be an array')
      else for (const event of manifest.events.subscribes) if (!EVENT_RE.test(String(event))) errors.push(`events.subscribes: "${event}" must look like "inventory.item.updated"`)
    }
  }
}
