import { FileSearch, Frame, LayoutGrid, Map, Square, Workflow } from 'lucide-react'

// Lucide icon per catalog `icon` name; labels and texts come from the API
// catalog (GET /canvas/templates).
const TEMPLATE_ICONS = { square: Square, frame: Frame, map: Map, workflow: Workflow, 'layout-grid': LayoutGrid, 'file-search': FileSearch }
export const templateIcon = (name) => TEMPLATE_ICONS[name] ?? Square

const UNITS = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]]
const relative = new Intl.RelativeTimeFormat('es', { numeric: 'auto' })

export function timeAgo(value, now = Date.now()) {
  const time = new Date(value).getTime()
  if (!Number.isFinite(time)) return ''
  const seconds = Math.round((time - now) / 1000)
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit)
  }
  return 'hace un momento'
}
