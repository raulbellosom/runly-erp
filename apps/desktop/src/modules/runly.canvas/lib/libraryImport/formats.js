export const LIBRARY_IMPORT_ACCEPT = '.excalidrawlib,.excalidraw,.json,.svg,.zip'

export function librarySourceKind(name) {
  const lower = String(name ?? '').toLowerCase()
  if (lower.endsWith('.svg') || lower.endsWith('.zip')) return 'svg'
  if (lower.endsWith('.excalidrawlib') || lower.endsWith('.excalidraw') || lower.endsWith('.json')) return 'excalidraw'
  return null
}

export const libraryBaseName = (name) => String(name ?? '').replace(/\.[^./\\]+$/, '') || String(name ?? '')
