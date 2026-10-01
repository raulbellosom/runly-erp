import { Button, Tooltip, TooltipContent, TooltipTrigger } from '@runly/ui'
import { Maximize, Minus, Plus } from 'lucide-react'
import { ToolButton } from './CanvasToolbar.jsx'

export function ZoomControls({ zoom, onZoomIn, onZoomOut, onReset, onFit }) {
  return (
    <div role="group" aria-label="Zoom" className="glass pointer-events-auto flex items-center gap-0.5 rounded-2xl p-1 shadow-lg">
      <ToolButton label="Alejar" shortcut="-" onClick={onZoomOut}><Minus /></ToolButton>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            onClick={onReset}
            aria-label={`Zoom ${Math.round(zoom * 100)}%. Restablecer a 100%`}
            className="h-11 min-w-14 rounded-lg px-2 font-mono text-xs tabular-nums sm:h-9"
          >
            {Math.round(zoom * 100)}%
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">Restablecer a 100% <kbd className="ml-1 font-mono text-[10px]">0</kbd></TooltipContent>
      </Tooltip>
      <ToolButton label="Acercar" shortcut="+" onClick={onZoomIn}><Plus /></ToolButton>
      <ToolButton label="Ajustar al contenido" shortcut="1" onClick={onFit}><Maximize /></ToolButton>
    </div>
  )
}
