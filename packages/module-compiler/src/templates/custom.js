import { moduleSlug } from './helpers.js'

export function generateCustomDashboardView(config) {
  const slug = moduleSlug(config.key)
  return `import { defineView } from '@runly/module-engine'

export default defineView({
  key: '${slug}.dashboard',
  kind: 'CUSTOM',
  version: '0.1.0',
  schema: {
    path: '/app/m/${config.key}/dashboard',
    component: '${config.key}:ModuleDashboard',
    title: 'Dashboard ${config.name}',
  },
})
`
}

export function generateComponentsIndex(config) {
  return `export async function register(registry) {
  if (typeof window === 'undefined') return

  const { default: ModuleDashboard } = await import('./ModuleDashboard.jsx')
  registry.register('${config.key}:ModuleDashboard', ModuleDashboard)
}
`
}

export function generateModuleDashboard(config) {
  return `import { Button, Card, CardContent, CardHeader, CardTitle, EmptyState, PageHeader } from '@runly/ui'
import { toast } from 'sonner'

export default function ModuleDashboard({ moduleKey }) {
  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Dashboard ${config.name}"
        description="Pantalla CUSTOM generada por el scaffolder oficial."
        actions={
          <Button onClick={() => toast.success('Componente CUSTOM listo para ' + moduleKey)}>
            Probar toast
          </Button>
        }
      />

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Bundle dinamico</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Este componente se registra desde components/index.js y no requiere rebuild del web image.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Proximo paso</CardTitle>
          </CardHeader>
          <CardContent>
            <EmptyState
              title="Conecta tu logica"
              description="Reemplaza este starter por consultas reales, KPI cards y acciones del modulo."
            />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
`
}
