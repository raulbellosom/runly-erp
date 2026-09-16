import { useEffect, useImperativeHandle, useState } from 'react'

// Floating menu rendered by SlashCommand.jsx via ReactRenderer + props.mount().
// Exposes onKeyDown imperatively so the Suggestion plugin can route arrow
// keys/Enter here while the "/" trigger is active (see extension's render()).
export function SlashCommandMenu({ items, command, ref }) {
  const [selected, setSelected] = useState(0)

  useEffect(() => setSelected(0), [items])

  useImperativeHandle(ref, () => ({
    onKeyDown({ event }) {
      if (items.length === 0) return false
      if (event.key === 'ArrowDown') {
        setSelected(i => (i + 1) % items.length)
        return true
      }
      if (event.key === 'ArrowUp') {
        setSelected(i => (i - 1 + items.length) % items.length)
        return true
      }
      if (event.key === 'Enter') {
        command(items[selected])
        return true
      }
      return false
    },
  }), [items, selected, command])

  if (items.length === 0) {
    return (
      <div className="relative z-50 w-64 rounded-xl glass-strong p-3 text-xs text-muted-foreground">
        Sin resultados
      </div>
    )
  }

  return (
    <div className="relative z-50 w-64 max-h-72 overflow-y-auto rounded-xl glass-strong p-1">
      {items.map((item, index) => {
        const Icon = item.icon
        return (
          <button
            key={item.title}
            onClick={() => command(item)}
            onMouseEnter={() => setSelected(index)}
            className={[
              'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm text-left transition-colors',
              index === selected
                ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                : 'text-foreground hover:bg-muted',
            ].join(' ')}
          >
            <Icon className="w-4 h-4 shrink-0 text-muted-foreground" />
            {item.title}
          </button>
        )
      })}
    </div>
  )
}
