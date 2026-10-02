import { useNavigate } from 'react-router-dom'
import { Button } from '@runly/ui'
import { ExternalLink, Link2 } from 'lucide-react'
import { useDataSources } from '../../hooks/useCanvasData.js'
import { Section } from './fields.jsx'

const DOT = { ok: 'bg-emerald-500', info: 'bg-blue-500', warning: 'bg-amber-500', danger: 'bg-red-500', neutral: 'bg-slate-400' }

// Shown for any bindable shape/text selected in the inspector (see
// lib/dataBindings.js canBind). `data` is this object's binding resolution
// from BoardEditor's useBindings() poll — undefined while it is still loading.
export function DataBindingSection({ object, data, readOnly = false, locked = false, onConnect, onDisconnect }) {
  const navigate = useNavigate()
  const binding = object.properties?.binding
  const sources = useDataSources()
  const sourceLabel = binding ? sources.data?.find((item) => item.key === binding.source)?.label ?? binding.source : null
  const editable = !readOnly && !locked

  if (!binding) {
    return (
      <Section title="Datos Runly">
        <p className="px-0.5 text-xs text-[hsl(var(--muted-foreground))]">Conecta esta forma a un registro de Runly para ver su estado en el lienzo.</p>
        {editable ? (
          <Button type="button" variant="outline" size="sm" className="w-full gap-1.5" onClick={onConnect}>
            <Link2 className="h-3.5 w-3.5" />Conectar a datos
          </Button>
        ) : null}
      </Section>
    )
  }

  if (!data) {
    return (
      <Section title="Datos Runly">
        <p className="px-0.5 text-xs text-[hsl(var(--muted-foreground))]">Cargando información del registro…</p>
      </Section>
    )
  }

  const unavailable = data.restricted || data.missing

  return (
    <Section title="Datos Runly">
      <div className="space-y-1.5 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-2.5">
        <div className="flex items-start gap-2">
          {!unavailable ? <span aria-hidden className={`mt-1 h-2 w-2 shrink-0 rounded-full ${DOT[data.tone] ?? DOT.neutral}`} /> : null}
          <div className="min-w-0 flex-1">
            <p className={`truncate text-sm font-semibold ${unavailable ? 'text-[hsl(var(--muted-foreground))]' : ''}`}>{data.title}</p>
            {sourceLabel ? <p className="truncate text-xs text-[hsl(var(--muted-foreground))]">{sourceLabel}</p> : null}
            {data.summary ? <p className="truncate text-xs text-[hsl(var(--muted-foreground))]">{data.summary}</p> : null}
          </div>
        </div>
        {data.metrics?.length ? (
          <dl className="grid grid-cols-2 gap-x-2 gap-y-1 pt-1 text-xs">
            {data.metrics.map((metric) => (
              <div key={metric.label} className="min-w-0">
                <dt className="truncate text-[hsl(var(--muted-foreground))]">{metric.label}</dt>
                <dd className="truncate font-medium">{metric.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {data.url ? (
          <Button type="button" variant="outline" size="sm" className="flex-1 gap-1" onClick={() => navigate(data.url)}>
            <ExternalLink className="h-3.5 w-3.5" />Abrir ficha
          </Button>
        ) : null}
        {editable ? (
          <>
            <Button type="button" variant="outline" size="sm" className="flex-1" onClick={onConnect}>Cambiar</Button>
            <Button type="button" variant="outline" size="sm" className="flex-1 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={onDisconnect}>Desconectar</Button>
          </>
        ) : null}
      </div>
    </Section>
  )
}
