export function dashboardFileName(view) {
  const leaf = String(view.key).split('.').at(-1).replace(/[^a-z0-9_-]/g, '-')
  return `views/${leaf}.dashboard.js`
}

export function generateDashboardView(view) {
  return `import { defineView } from '@runly/module-engine'

export default defineView(${JSON.stringify({
    key: view.key,
    kind: 'DASHBOARD',
    version: view.version ?? '0.1.0',
    schema: view.schema,
  }, null, 2)})
`
}
