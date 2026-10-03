import { ActionMenu, Button, Skeleton, Tooltip, TooltipContent, TooltipTrigger, cn, useIsMobile, PersonAvatar } from '@runly/ui'
import { ArrowLeft, Check, Eye, History, Loader2, Maximize2, Minimize2, PanelLeft, PanelRight, Pencil, Redo2, Share2, Trash2, Undo2 } from 'lucide-react'
import { canEditBoard } from '../lib/roles.js'
import { ToolButton } from './CanvasToolbar.jsx'
import { ExportMenu } from './ExportMenu.jsx'
import { MobileEditorMenu } from './MobileEditorMenu.jsx'

function PresenceStack({ users }) {
  if (!users.length) return null
  const visible = users.slice(0, 3), extra = users.length - visible.length
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex -space-x-2" aria-label={`${users.length} colaborador(es) conectados`} role="img">
          {visible.map((user) => (
            <PersonAvatar key={user.id} name={user.name} src={user.avatarUrl ?? null} size="md" className="h-8 w-8 ring-2 ring-[hsl(var(--card))]" />
          ))}
          {extra > 0 ? <span className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-[hsl(var(--card))] bg-[hsl(var(--muted))] text-[11px] font-semibold tabular-nums">+{extra}</span> : null}
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom">{users.map((user) => user.name).join(', ')}</TooltipContent>
    </Tooltip>
  )
}

function SaveStatus({ saving }) {
  return (
    <span role="status" aria-live="polite" className="hidden items-center gap-1.5 text-xs text-[hsl(var(--muted-foreground))] sm:inline-flex">
      {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />}
      {saving ? 'Guardando…' : 'Guardado'}
    </span>
  )
}

export function EditorTopBar({ title, subtitle, loading, saving, presence, onBack, leftOpen, rightOpen, onToggleLeft, onToggleRight, zen, onToggleZen, history, readOnly = false, onShare, onVersions, onExport, exportDisabled, myRole, onRenameBoard, onDeleteBoard }) {
  const phone = useIsMobile()
  const moreItems = [
    canEditBoard(myRole) && onRenameBoard ? { label: 'Renombrar Board', icon: Pencil, onClick: onRenameBoard } : null,
    myRole === 'OWNER' && onDeleteBoard ? { label: 'Eliminar Board', icon: Trash2, onClick: onDeleteBoard, variant: 'destructive' } : null,
  ].filter(Boolean)
  const titleBlock = loading ? (
    <div className="space-y-1"><Skeleton className="h-4 w-36" /><Skeleton className="h-3 w-20" /></div>
  ) : (
    <>
      <h1 className="truncate text-sm font-semibold leading-tight text-[hsl(var(--foreground))]" title={title}>{title}</h1>
      <p className="truncate text-xs leading-tight text-[hsl(var(--muted-foreground))]">{subtitle}</p>
    </>
  )
  const readOnlyBadge = (
    <span className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-[hsl(var(--muted))] px-3 text-xs font-medium text-[hsl(var(--muted-foreground))]">
      <Eye className="h-3.5 w-3.5" /><span className="hidden sm:inline">Solo lectura</span>
    </span>
  )

  // Phone: back, title, undo/redo and ONE overflow menu for everything else
  // (panels, share, versions, export, rename/delete) — nine separate buttons
  // do not fit a 390px-wide bar. Tablet and desktop keep the full bar below.
  if (phone) {
    return (
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--card))] px-2">
        <Button type="button" variant="ghost" size="icon" onClick={onBack} aria-label="Volver a Boards" className="h-10 w-10 shrink-0 rounded-lg">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1 px-1">{titleBlock}</div>
        {readOnly ? readOnlyBadge : (
          <div className="flex items-center gap-0.5" role="group" aria-label="Historial">
            <ToolButton label={history.undoLabel ? `Deshacer: ${history.undoLabel}` : 'Deshacer'} shortcut="Ctrl+Z" disabled={!history.canUndo} onClick={history.undo} className="h-10 w-10"><Undo2 /></ToolButton>
            <ToolButton label={history.redoLabel ? `Rehacer: ${history.redoLabel}` : 'Rehacer'} shortcut="Ctrl+Shift+Z" disabled={!history.canRedo} onClick={history.redo} className="h-10 w-10"><Redo2 /></ToolButton>
          </div>
        )}
        <MobileEditorMenu
          leftOpen={leftOpen} onToggleLeft={onToggleLeft} rightOpen={rightOpen} onToggleRight={onToggleRight}
          onShare={onShare} onVersions={onVersions} onExport={onExport} exportDisabled={exportDisabled}
          myRole={myRole} onRenameBoard={onRenameBoard} onDeleteBoard={onDeleteBoard}
        />
      </header>
    )
  }

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--card))] px-2 sm:px-3">
      <Button type="button" variant="ghost" onClick={onBack} aria-label="Volver a Boards" className="h-11 shrink-0 gap-1.5 px-2.5 sm:h-9">
        <ArrowLeft className="h-4 w-4" />
        <span className="hidden sm:inline">Boards</span>
      </Button>
      <span aria-hidden className="hidden h-6 w-px bg-[hsl(var(--border))] sm:block" />
      <div className="min-w-0 flex-1 px-1">{titleBlock}</div>
      {readOnly ? readOnlyBadge : (
        <>
          <div className="flex items-center gap-0.5" role="group" aria-label="Historial">
            <ToolButton label={history.undoLabel ? `Deshacer: ${history.undoLabel}` : 'Deshacer'} shortcut="Ctrl+Z" disabled={!history.canUndo} onClick={history.undo}><Undo2 /></ToolButton>
            <ToolButton label={history.redoLabel ? `Rehacer: ${history.redoLabel}` : 'Rehacer'} shortcut="Ctrl+Shift+Z" disabled={!history.canRedo} onClick={history.redo}><Redo2 /></ToolButton>
          </div>
          <SaveStatus saving={saving} />
        </>
      )}
      <PresenceStack users={presence} />
      {moreItems.length ? <ActionMenu items={moreItems} label="Más opciones" /> : null}
      <ExportMenu disabled={exportDisabled} onExport={onExport} />
      <ToolButton label="Versiones" onClick={onVersions}><History /></ToolButton>
      <Button type="button" variant="outline" onClick={onShare} className="h-11 shrink-0 gap-1.5 px-3 sm:h-9" aria-label="Compartir Board">
        <Share2 className="h-4 w-4" /><span className="hidden md:inline">Compartir</span>
      </Button>
      <div className="flex items-center gap-0.5">
        <ToolButton label={leftOpen ? 'Ocultar páginas y capas' : 'Páginas y capas'} active={leftOpen} onClick={onToggleLeft} className={cn(leftOpen && 'bg-[hsl(var(--muted))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]')}>
          <PanelLeft />
        </ToolButton>
        <ToolButton label={rightOpen ? 'Ocultar inspector' : 'Inspector'} active={rightOpen} onClick={onToggleRight} className={cn(rightOpen && 'bg-[hsl(var(--muted))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]')}>
          <PanelRight />
        </ToolButton>
        <ToolButton label={zen ? 'Salir de pantalla completa (Esc)' : 'Pantalla completa'} active={false} onClick={onToggleZen} className="max-sm:hidden">
          {zen ? <Minimize2 /> : <Maximize2 />}
        </ToolButton>
      </div>
    </header>
  )
}
