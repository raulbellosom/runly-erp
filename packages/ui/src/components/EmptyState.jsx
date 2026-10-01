import { isValidElement } from 'react'
import { cn } from '../lib/utils.js'
import { Button } from './Button.jsx'

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  children,
  variant = 'default',
  className,
}) {
  if (variant === 'compact') {
    return (
      <div className={cn('flex items-center gap-3 rounded-lg border border-dashed border-[hsl(var(--border))] px-4 py-3 text-sm text-[hsl(var(--muted-foreground))]', className)}>
        {Icon && <Icon className="h-4 w-4 shrink-0" />}
        <span>{title}</span>
        {isValidElement(action) ? <div className="ml-auto">{action}</div> : action && (
          <Button size="sm" variant="ghost" onClick={action.onClick} className="ml-auto">
            {action.label}
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className={cn('flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-[hsl(var(--border))] px-6 py-14 text-center', className)}>
      {Icon && (
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[hsl(var(--muted))]">
          <Icon className="h-7 w-7 text-[hsl(var(--muted-foreground))]" />
        </div>
      )}
      <div className="space-y-1.5">
        <p className="text-sm font-semibold text-[hsl(var(--foreground))]">{title}</p>
        {description && (
          <p className="max-w-xs text-sm text-[hsl(var(--muted-foreground))] leading-relaxed">{description}</p>
        )}
      </div>
      {/* `action` accepts either { label, onClick } or a ready-made element
          (e.g. a <Button>); rendering an element as action.label produced an
          empty button that showed up as a lone colored dot. */}
      {isValidElement(action) ? action : action && (
        <Button size="sm" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
      {children}
    </div>
  )
}
