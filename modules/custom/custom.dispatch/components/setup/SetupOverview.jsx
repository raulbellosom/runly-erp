import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ProgressBar,
  SectionCard,
} from '@runly/ui'
import { ArrowRight, Check, CircleDashed, ClipboardCheck, Scale } from 'lucide-react'
import { buildReadiness } from '../lib/catalog-config.js'

export default function SetupOverview({ setup, onGo }) {
  const readiness = buildReadiness(setup)
  const complete = readiness.filter((item) => item.ready).length
  const progress = Math.round((complete / readiness.length) * 100)
  const next = readiness.find((item) => !item.ready)

  return (
    <div className="space-y-5">
      <Card variant="bordered">
        <CardHeader className="space-y-5 pb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Badge variant="secondary">Estado operativo</Badge>
            <span className="text-sm text-muted-foreground">
              {complete} de {readiness.length} pasos listos
            </span>
          </div>

          <div className="flex flex-wrap items-start gap-6">
            <div className="min-w-0 space-y-2" style={{ flex: '2 1 30rem' }}>
              <CardTitle className="text-2xl tracking-tight">
                Catálogos de despacho
              </CardTitle>
              <CardDescription className="max-w-2xl text-sm leading-6">
                Controla la estructura utilizada por venta, báscula y salida de materiales.
              </CardDescription>
            </div>

            <div
              className="flex min-w-0 items-center justify-between gap-4 rounded-xl border border-border bg-muted/30 p-4"
              style={{ flex: '1 1 15rem' }}
            >
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  Cobertura
                </p>
                <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">{progress}%</p>
              </div>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Scale className="h-5 w-5" />
              </div>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-5 pt-0">
          <div className="space-y-2">
            <ProgressBar value={progress} />
            <p className="text-xs leading-5 text-muted-foreground">
              Sitios, estaciones, materiales, responsables y series disponibles para operar.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            {next ? (
              <Button className="shrink-0" onClick={() => onGo(next.resource, next.intent)}>
                Completar {next.label.toLowerCase()}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            ) : (
              <Button className="shrink-0" variant="outline" onClick={() => onGo('sites')}>
                Revisar configuración
                <ClipboardCheck className="ml-2 h-4 w-4" />
              </Button>
            )}
            <p className="min-w-0 text-sm text-muted-foreground" style={{ flex: '1 1 14rem' }}>
              {next ? `${next.label} requiere configuración.` : 'Todos los componentes operativos están configurados.'}
            </p>
          </div>
        </CardContent>
      </Card>

      <SectionCard
        title="Componentes operativos"
        description="Consulta el estado de cada catálogo y administra sus registros."
      >
        <div className="divide-y divide-border">
          {readiness.map((item) => {
            const Icon = item.icon
            return (
              <Button
                key={item.key}
                type="button"
                variant="ghost"
                onClick={() => onGo(item.resource, item.ready ? null : item.intent)}
                className="h-auto w-full justify-start rounded-none px-0 py-3.5 text-left font-normal first:pt-1 last:pb-1"
              >
                <span
                  className={
                    item.ready
                      ? 'flex h-8 w-8 items-center justify-center rounded-full bg-success/10 text-success'
                      : 'flex h-8 w-8 items-center justify-center rounded-full bg-muted text-muted-foreground'
                  }
                >
                  {item.ready ? <Check className="h-4 w-4" /> : <CircleDashed className="h-4 w-4" />}
                </span>
                <Icon className="ml-3 h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="ml-3 flex-1 text-sm font-medium text-foreground">{item.label}</span>
                <span className="text-xs text-muted-foreground">
                  {item.ready ? 'Listo' : 'Pendiente'}
                </span>
                <ArrowRight className="ml-3 h-4 w-4 text-muted-foreground" />
              </Button>
            )
          })}
        </div>
      </SectionCard>
    </div>
  )
}
