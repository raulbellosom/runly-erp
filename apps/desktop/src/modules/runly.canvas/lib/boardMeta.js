import { FileSearch, Frame, LayoutGrid, Map, Square, Workflow } from 'lucide-react'

export const BOARD_TEMPLATES = [
  { value: 'blank', label: 'En blanco', description: 'Lienzo libre', icon: Square },
  { value: 'plan', label: 'Plano', description: 'Planta o croquis', icon: Frame },
  { value: 'technical-map', label: 'Mapa técnico', description: 'Instalaciones y puntos', icon: Map },
  { value: 'diagram', label: 'Diagrama', description: 'Procesos y flujos', icon: Workflow },
  { value: 'layout', label: 'Distribución', description: 'Espacios y mobiliario', icon: LayoutGrid },
  { value: 'pdf-review', label: 'Revisión de PDF', description: 'Marcas sobre documentos', icon: FileSearch },
]

export function templateMeta(value) {
  return BOARD_TEMPLATES.find((template) => template.value === value) ?? BOARD_TEMPLATES[0]
}

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
