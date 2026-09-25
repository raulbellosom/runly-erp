import { AlertTriangle } from 'lucide-react'
import { Button } from './Button.jsx'
import { cn } from '../lib/utils.js'
import { requestBugReport } from '../lib/bugReportBus.js'

export function ErrorState({ title = 'Error al cargar', description, onRetry, className }) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-destructive/30 bg-destructive/5 px-6 py-14 text-center', className)}>
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10">
        <AlertTriangle className="h-7 w-7 text-destructive" />
      </div>
      <div className="space-y-1.5">
        <p className="text-sm font-semibold text-[hsl(var(--foreground))]">{title}</p>
        {description && (
          <p className="max-w-xs text-sm text-[hsl(var(--muted-foreground))] leading-relaxed">{description}</p>
        )}
      </div>
      <div className="flex items-center gap-2">
        {onRetry && (
          <Button size="sm" variant="outline" onClick={onRetry}>
            Reintentar
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => requestBugReport({
            context: typeof window !== 'undefined' ? window.location.pathname : null,
            message: description || title,
          })}
        >
          Reportar bug
        </Button>
      </div>
    </div>
  )
}
