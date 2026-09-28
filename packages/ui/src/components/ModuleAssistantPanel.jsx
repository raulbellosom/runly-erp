import { useState } from 'react'
import { ArrowLeft, MessageSquare, Plus, Sparkles, Trash2, X } from 'lucide-react'
import { cn } from '../lib/utils.js'
import { AssistantWordmark } from './AssistantWordmark.jsx'
import { Button } from './Button.jsx'
import { ConfirmDialog } from './ConfirmDialog.jsx'
import { EmptyState } from './EmptyState.jsx'
import { ErrorState } from './ErrorState.jsx'

function PanelAvatar() {
  return <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: 'var(--brand-primary)', color: 'var(--brand-primary-foreground)' }}><Sparkles className="h-3.5 w-3.5" /></div>
}

// ChatGPT-style module assistant panel: a full-height conversation list, and
// a chat view (back button + title) that replaces the list while open. Data
// fetching, the thread and the composer stay in the module (`children`).
// Header and composer stay fixed; only the list / thread scroll. Inside a
// Sheet (which draws its own close button), omit onClose and pass
// headerClassName="pr-12".
export function ModuleAssistantPanel({
  subtitle,
  view,
  onBack,
  onClose,
  conversations = [],
  conversationsError,
  conversationsLoading = false,
  activeId = null,
  onSelect,
  onNew,
  onDelete,
  chatTitle = 'Nueva consulta',
  chatContext,
  busy = false,
  listLabel = 'Conversaciones',
  className,
  headerClassName,
  children,
}) {
  const [remove, setRemove] = useState(null)
  const closeButton = onClose && <Button size="icon" variant="ghost" aria-label="Cerrar asistente" onClick={onClose}><X className="h-4 w-4" /></Button>

  if (view === 'chat') {
    return <div className={cn('flex min-h-0 flex-1 flex-col', className)}>
      <div className={cn('shrink-0 space-y-2 border-b p-3', headerClassName)}>
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" aria-label="Volver a las conversaciones" disabled={busy} onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button>
          <PanelAvatar />
          <span className="min-w-0 flex-1 truncate pl-1 text-sm font-semibold" title={chatTitle}>{chatTitle}</span>
          {closeButton}
        </div>
        {chatContext && <div className="pl-10">{chatContext}</div>}
      </div>
      {children}
    </div>
  }

  return <div className={cn('flex min-h-0 flex-1 flex-col', className)}>
    <div className={cn('flex shrink-0 items-center justify-between gap-2 border-b p-3', headerClassName)}>
      <span className="flex items-center gap-2">
        <PanelAvatar />
        <span className="leading-tight"><AssistantWordmark className="block text-sm font-semibold" />{subtitle && <span className="block text-xs text-muted-foreground">{subtitle}</span>}</span>
      </span>
      {closeButton}
    </div>
    <div className="shrink-0 p-3 pb-2">
      <Button variant="outline" size="sm" className="w-full" disabled={busy} onClick={onNew}><Plus className="h-4 w-4" />Nueva consulta</Button>
    </div>
    <nav aria-label={listLabel} className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 pb-3">
      {conversationsError && <ErrorState title="No se pudo cargar el historial" description={conversationsError} />}
      {!conversationsError && !conversationsLoading && !conversations.length && <EmptyState variant="compact" icon={MessageSquare} title="Aún no hay conversaciones" />}
      {conversations.map(item => <div key={item.id} className="group flex items-center gap-1">
        <Button variant={item.id === activeId ? 'secondary' : 'ghost'} size="sm" className="h-auto min-w-0 flex-1 justify-start py-2" disabled={busy}
          aria-current={item.id === activeId ? 'true' : undefined} onClick={() => onSelect?.(item)}>
          <MessageSquare className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1 text-left"><span className="block truncate">{item.title}</span>{item.meta && <span className="block truncate text-xs font-normal text-muted-foreground">{item.meta}</span>}</span>
        </Button>
        {onDelete && <Button variant="ghost" size="icon" aria-label={`Eliminar ${item.title}`} disabled={busy} onClick={() => setRemove(item)}><Trash2 className="h-3.5 w-3.5" /></Button>}
      </div>)}
    </nav>
    <ConfirmDialog open={Boolean(remove)} onOpenChange={value => !value && setRemove(null)} title="Eliminar conversación" description="Se eliminarán esta conversación y sus mensajes." confirmLabel="Eliminar"
      onConfirm={async () => { const item = remove; setRemove(null); await onDelete?.(item) }} />
  </div>
}
