export function kanbanFileName(view) {
  const leaf = String(view.key).split('.').at(-1).replace(/[^a-z0-9_-]/g, '-')
  return `views/${leaf}.kanban.js`
}

export function generateKanbanView(view) {
  return `import { defineView } from '@runly/module-engine'

export default defineView(${JSON.stringify({ key: view.key, kind: 'KANBAN', version: view.version ?? '0.1.0', schema: view.schema }, null, 2)})
`
}
