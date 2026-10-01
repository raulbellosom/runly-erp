import { useState } from 'react'
import { RefreshCw, CheckCircle, WifiOff } from 'lucide-react'
import { Popover, PopoverTrigger, PopoverContent } from './Popover.jsx'
import { Button } from './Button.jsx'

function formatRelativeTime(isoString) {
  if (!isoString) return null
  const diffMs = Date.now() - new Date(isoString).getTime()
  if (diffMs < 3_600_000) return `hace ${Math.floor(diffMs / 60_000)} min`
  return `hace ${Math.floor(diffMs / 3_600_000)} h`
}

/**
 * Single-icon site status control for the Topbar. Collapses online/offline,
 * sync-engine activity, react-query network activity, and pending-mutation
 * count into one button; the detail opens in a popover.
 *
 * Replaces the older `SyncStatusBar` + `OfflineIndicator` + inline "Sincronizando..." pill.
 */
export function SyncStatusPopover({
  isOnline = true,
  isSyncing = false,
  lastSyncAt = null,
  pendingCount = 0,
  syncError = null,
  networkBusy = false,
  onSyncNow,
  onReconnect,
}) {
  const [reconnecting, setReconnecting] = useState(false)
  const [reconnectFailed, setReconnectFailed] = useState(false)
  const busy = isSyncing || networkBusy

  async function handleReconnect() {
    setReconnecting(true)
    setReconnectFailed(false)
    try {
      const online = await onReconnect()
      setReconnectFailed(online === false)
    } catch {
      setReconnectFailed(true)
    } finally {
      setReconnecting(false)
    }
  }
  const hasPending = pendingCount > 0

  let StatusIcon
  let iconClass
  let statusLabel
  if (!isOnline) {
    StatusIcon = WifiOff
    iconClass = 'text-amber-500 dark:text-amber-400'
    statusLabel = 'Sin conexion'
  } else if (busy) {
    StatusIcon = RefreshCw
    iconClass = 'text-[hsl(var(--primary))]'
    statusLabel = 'Sincronizando...'
  } else {
    StatusIcon = CheckCircle
    iconClass = 'text-green-500 dark:text-green-400'
    statusLabel = 'En linea'
  }

  const triggerLabel =
    hasPending && isOnline
      ? `Estado: ${pendingCount} ${pendingCount === 1 ? 'cambio pendiente' : 'cambios pendientes'}`
      : `Estado: ${statusLabel.toLowerCase()}`

  const relTime = formatRelativeTime(lastSyncAt)

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={triggerLabel}
          aria-label={triggerLabel}
          className="relative h-9 w-9 flex items-center justify-center rounded-lg cursor-pointer text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors duration-150 outline-none"
        >
          <StatusIcon
            size={16}
            className={busy && isOnline ? `${iconClass} animate-spin` : iconClass}
          />
          {hasPending && (
            <span
              className="absolute top-1 right-1 h-2 w-2 rounded-full bg-amber-500 dark:bg-amber-400 pointer-events-none shadow-[0_0_6px_rgba(245,158,11,0.6)]"
              aria-hidden="true"
            />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3">
        <div className="flex items-center gap-2">
          <StatusIcon size={16} className={iconClass} />
          <span className="text-sm font-semibold text-[hsl(var(--foreground))]">
            {statusLabel}
          </span>
        </div>
        <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">
          Ultima sincronizacion: {relTime ?? '—'}
        </p>
        {hasPending && (
          <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
            {pendingCount} {pendingCount === 1 ? 'cambio pendiente' : 'cambios pendientes'}
          </p>
        )}
        {syncError && (
          <p className="mt-1 text-xs text-[hsl(var(--destructive))] break-words">
            {syncError}
          </p>
        )}
        {onReconnect && !isOnline && (
          <>
            {reconnectFailed && !reconnecting && (
              <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                Aun sin conexion con el servidor. Revisa tu red e intenta de nuevo.
              </p>
            )}
            <Button
              variant="outline"
              size="sm"
              className="mt-3 w-full"
              onClick={handleReconnect}
              disabled={reconnecting}
            >
              <RefreshCw className={reconnecting ? 'animate-spin motion-reduce:animate-none' : undefined} />
              {reconnecting ? 'Reconectando...' : 'Reintentar conexion'}
            </Button>
          </>
        )}
        {onSyncNow && isOnline && !isSyncing && (
          <Button
            variant="outline"
            size="sm"
            className="mt-3 w-full"
            onClick={onSyncNow}
          >
            Sincronizar ahora
          </Button>
        )}
      </PopoverContent>
    </Popover>
  )
}
