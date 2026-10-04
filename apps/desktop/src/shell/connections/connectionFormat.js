// Display helpers for connected values (spec 2026-10-03-rme3-module-platform-v2 §8.2).

export function optionLabel(field, value) {
  const option = (field.options ?? []).find((o) => (o?.value ?? o) === value)
  return option ? (option.label ?? option.value ?? option) : value
}

// Raw value from the index -> short Spanish text for detail/list display.
export function displayValue(field, value) {
  if (value === null || value === undefined || value === '') return '—'
  switch (field.type) {
    case 'boolean':
      return value ? 'Sí' : 'No'
    case 'date': {
      // Calendar date: read the YYYY-MM-DD part, never shift by time zone.
      const [y, m, d] = String(value).slice(0, 10).split('-')
      return y && m && d ? `${d}/${m}/${y}` : String(value)
    }
    case 'datetime': {
      const date = new Date(value)
      return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })
    }
    case 'select':
      return String(optionLabel(field, value))
    case 'multiselect':
      return (Array.isArray(value) ? value : [value]).map((v) => optionLabel(field, v)).join(', ')
    case 'decimal':
    case 'number': {
      const number = Number(value)
      return Number.isFinite(number) ? number.toLocaleString('es-MX') : String(value)
    }
    case 'json':
      return typeof value === 'string' ? value : JSON.stringify(value)
    default:
      return String(value)
  }
}

// Field types the core form edits inline; others show read-only.
export const EDITABLE_TYPES = new Set(['text', 'textarea', 'markdown', 'email', 'phone', 'number', 'decimal', 'date', 'boolean', 'select'])
