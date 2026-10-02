import { Button, Tooltip, TooltipContent, TooltipTrigger, cn } from '@runly/ui'
import { Maximize, Minus, Plus } from 'lucide-react'
import { ToolButton } from './CanvasToolbar.jsx'

// Horizontal by default (POS floors); the Canvas editor stacks it vertically
// on the right edge, with optional extra controls (scale) on top. `compact`
// (phone editor only) shrinks everything to 36px, drops +/- (pinch covers
// zooming) and shows just scale/percent/fit.
export function ZoomControls({ zoom, onZoomIn, onZoomOut, onReset, onFit, orientation = 'horizontal', compact = false, children }) {
  const vertical = orientation === 'vertical'
  const tipSide = vertical ? 'left' : 'top'
  const percent = (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          onClick={onReset}
          aria-label={`Zoom ${Math.round(zoom * 100)}%. Restablecer a 100%`}
          className={cn('rounded-lg font-mono tabular-nums', compact ? 'h-9 w-9 px-0 text-[10px]' : vertical ? 'h-9 w-11 px-0 text-[11px]' : 'h-11 min-w-14 px-2 text-xs sm:h-9')}
        >
          {Math.round(zoom * 100)}%
        </Button>
      </TooltipTrigger>
      <TooltipContent side={tipSide}>Restablecer a 100% <kbd className="ml-1 font-mono text-[10px]">0</kbd></TooltipContent>
    </Tooltip>
  )
  const zoomOut = <ToolButton label="Alejar" shortcut="-" side={tipSide} onClick={onZoomOut}><Minus /></ToolButton>
  const zoomIn = <ToolButton label="Acercar" shortcut="+" side={tipSide} onClick={onZoomIn}><Plus /></ToolButton>
  const fitButton = (
    <ToolButton label="Ajustar al contenido" shortcut="1" side={tipSide} onClick={onFit} className={compact ? 'h-9 w-9' : undefined}><Maximize /></ToolButton>
  )
  return (
    <div role="group" aria-label="Zoom" className={cn('glass pointer-events-auto flex items-center gap-0.5 rounded-2xl p-1 shadow-lg', vertical && 'flex-col')}>
      {children ? (
        <>
          {children}
          <span aria-hidden className={cn('bg-[hsl(var(--border))]', vertical ? 'my-0.5 h-px w-6' : 'mx-0.5 h-6 w-px')} />
        </>
      ) : null}
      {compact ? percent : vertical ? <>{zoomIn}{percent}{zoomOut}</> : <>{zoomOut}{percent}{zoomIn}</>}
      {fitButton}
    </div>
  )
}
