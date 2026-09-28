// Emits CARDS / CALENDAR / TIMELINE / REPORT views as defineView() files.
// The schema is JSON-serialized (never string-interpolated), like kanban.js.
export function recordsViewFileName(view) {
  const leaf = String(view.key).split('.').at(-1).replace(/[^a-z0-9_-]/g, '-')
  const middle = String(view.key).split('.').slice(1, -1).join('-').replace(/[^a-z0-9_-]/g, '-')
  return `views/${middle ? `${middle}.` : ''}${leaf}.js`
}

export function generateRecordsView(view) {
  return `import { defineView } from '@runly/module-engine'

export default defineView(${JSON.stringify({ key: view.key, kind: view.kind, version: view.version ?? '0.1.0', schema: view.schema }, null, 2)})
`
}
