// Right-click menu for the floor planner canvas, positioned at the
// FloorPlannerStage-computed page point (see handleContextMenu there).
export function ContextMenuOverlay({ menu, onAction, onClose, hasClipboard }) {
  const items = menu.elementId
    ? [
        { label: 'Duplicar',         shortcut: 'Ctrl+D', action: 'duplicate' },
        { label: 'Copiar',           shortcut: 'Ctrl+C', action: 'copy' },
        null,
        { label: 'Traer al frente',  action: 'bringForward' },
        { label: 'Enviar atrás',     action: 'sendBackward' },
        null,
        { label: 'Eliminar',         shortcut: 'Del',    action: 'delete', danger: true },
      ]
    : hasClipboard
      ? [{ label: 'Pegar', shortcut: 'Ctrl+V', action: 'paste' }]
      : []

  if (!items.length) return null

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose() }} />
      <div
        className="fixed z-50 rounded-2xl py-1.5 text-sm overflow-hidden"
        style={{
          left: Math.min(menu.clientX, window.innerWidth - 204),
          top: Math.min(menu.clientY, window.innerHeight - 224),
          minWidth: 188,
          background: 'rgba(14, 14, 22, 0.68)',
          backdropFilter: 'blur(32px) saturate(200%) brightness(1.08)',
          WebkitBackdropFilter: 'blur(32px) saturate(200%) brightness(1.08)',
          border: '1px solid rgba(255, 255, 255, 0.09)',
          boxShadow: [
            '0 12px 48px rgba(0,0,0,0.55)',
            '0 4px 16px rgba(0,0,0,0.35)',
            'inset 0 1px 0 rgba(255,255,255,0.10)',
            'inset 0 -1px 0 rgba(255,255,255,0.03)',
          ].join(', '),
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 pointer-events-none"
          style={{
            height: 1,
            background: 'linear-gradient(90deg, transparent 8%, rgba(255,255,255,0.22) 35%, rgba(255,255,255,0.22) 65%, transparent 92%)',
          }}
        />

        {items.map((item, i) =>
          item === null ? (
            <div
              key={i}
              className="mx-2 my-1.5"
              style={{ height: 1, background: 'rgba(255,255,255,0.07)' }}
            />
          ) : (
            <button
              key={item.action}
              type="button"
              onClick={() => { onAction(item.action, menu.elementId); onClose() }}
              className={[
                'group flex items-center justify-between rounded-lg transition-all duration-75',
                'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30',
                item.danger
                  ? 'text-red-400 hover:text-red-300 hover:bg-red-500/13'
                  : 'hover:bg-white/[0.07]',
              ].join(' ')}
              style={{
                width: 'calc(100% - 8px)',
                margin: '1px 4px',
                padding: '6px 10px',
                color: item.danger ? undefined : 'rgba(255,255,255,0.82)',
              }}
            >
              <span className="font-[450] tracking-[-0.01em]">{item.label}</span>
              {item.shortcut && (
                <span
                  className="ml-5 font-mono text-[10px] tabular-nums transition-colors group-hover:opacity-70"
                  style={{ color: 'rgba(255,255,255,0.30)' }}
                >
                  {item.shortcut}
                </span>
              )}
            </button>
          ),
        )}
      </div>
    </>
  )
}
