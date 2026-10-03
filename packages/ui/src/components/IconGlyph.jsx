import { createElement } from 'react'
import { getIconNode } from '../engine/icons.js'

// Renders a lucide icon by its kebab-case name from the shared icon registry.
export function IconGlyph({ name, className = 'h-5 w-5', strokeWidth = 2 }) {
  const node = getIconNode(name)
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {node ? node.map(([tag, attrs], index) => {
        const { key: _key, ...rest } = attrs ?? {}
        return createElement(tag, { key: index, ...rest })
      }) : <circle cx="12" cy="12" r="3" opacity="0.25" />}
    </svg>
  )
}
