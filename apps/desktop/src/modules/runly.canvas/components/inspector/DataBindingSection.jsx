import { useNavigate } from 'react-router-dom'
import { Button, SwitchField } from '@runly/ui'
import * as LucideIcons from 'lucide-react'
import { ExternalLink, Link2 } from 'lucide-react'
import { useDataSources } from '../../hooks/useCanvasData.js'
import { hasStatusTone, sourceIcon, statusTintOf } from '../../lib/dataBindings.js'
import { Section } from './fields.jsx'

const DOT = { ok: 'bg-emerald-500', info: 'bg-blue-500', warning: 'bg-amber-500', danger: 'bg-red-500', neutral: 'bg-slate-500' }
// Same icon the canvas badge draws (lib/dataBindings.js SOURCE_ICONS), as a
// React component; lucide is already in the bundle (see engine/icons.js).
const getLucideIcon = (kebab) => LucideIcons[kebab.split('-').map((part) => part[0].toUpperCase() + part.slice(1)).join('')] ?? LucideIcons.Database

// Shown for any bindable shape/text selected in the inspector (see
// lib/dataBindings.js canBind). `data` is this object's binding resolution
// from BoardEditor's useBindings() poll — undefined while it is still loading.
export function DataBindingSection({ object, data, readOnly = false, locked = false, onConnect, onDisconnect, onToggleTint }) {
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
  const statusTone = !unavailable && hasStatusTone(data)
  const tinted = Boolean(statusTintOf(binding, data))
  const SourceIcon = getLucideIcon(sourceIcon(binding.source))

  return (
    <Section title="Datos Runly">
      <div className="space-y-1.5 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-2.5">
        <div className="flex items-start gap-2.5">
          <span aria-hidden className={`flex size-8 shrink-0 items-center justify-center rounded-lg text-white ${unavailable ? 'bg-slate-400' : DOT[data.tone] ?? DOT.neutral}`}>
            {SourceIcon ? <SourceIcon className="size-4" /> : null}
          </span>
          <div className="min-w-0 flex-1">
            <p className={`truncate text-sm font-semibold ${unavailable ? 'text-[hsl(var(--muted-foreground))]' : ''}`}>{data.title}</p>
            {sourceLabel ? <p className="truncate text-xs text-[hsl(var(--muted-foreground))]">{sourceLabel}</p> : null}
            {data.summary ? <p className="truncate text-xs text-[hsl(var(--muted-foreground))]">{data.summary}</p> : null}
          </div>
        </div>
        {statusTone ? (
          <div className="border-t border-[hsl(var(--border))] pt-2">
            <SwitchField
              label="Color según el estado"
              description={tinted ? 'El borde y el relleno muestran el estado del registro.' : 'La forma usa los colores que elijas en Apariencia.'}
              checked={tinted} disabled={!editable} onChange={onToggleTint}
            />
          </div>
        ) : null}
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
