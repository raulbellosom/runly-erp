// Pure filter/sort logic for the Canvas home list — kept framework-free so it
// is unit-testable and shared between the local-only filter pass and the
// server-search result pass (see CanvasHome.jsx).
export const DEFAULT_FILTERS = { templates: [], access: 'all', updated: 'any', sort: 'recent' }

const DAY_MS = 86_400_000

function sameLocalDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function matchesTemplate(board, templates) {
  return !templates.length || templates.includes(board.templateType)
}

function matchesAccess(board, access) {
  if (access === 'mine') return board.myRole === 'OWNER'
  if (access === 'shared') return board.myRole !== 'OWNER'
  return true
}

function matchesUpdated(board, updated, now) {
  if (updated === 'any') return true
  const updatedAt = board.updatedAt ? new Date(board.updatedAt) : null
  if (!updatedAt || Number.isNaN(updatedAt.getTime())) return false
  if (updated === 'today') return sameLocalDay(updatedAt, new Date(now))
  const days = updated === '7d' ? 7 : updated === '30d' ? 30 : null
  return days == null || now - updatedAt.getTime() <= days * DAY_MS
}

// `sort: null` means "keep the given order" (the server search result's own
// ranking) — used when the home list is driven by search instead of filters.
function sortBoards(boards, sort) {
  if (!sort) return boards
  const copy = [...boards]
  if (sort === 'name') return copy.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'es'))
  if (sort === 'oldest') return copy.sort((a, b) => new Date(a.createdAt ?? 0) - new Date(b.createdAt ?? 0))
  return copy.sort((a, b) => new Date(b.updatedAt ?? 0) - new Date(a.updatedAt ?? 0)) // 'recent'
}

export function applyBoardFilters(boards, filters = DEFAULT_FILTERS, now = Date.now()) {
  const templates = filters.templates ?? [], access = filters.access ?? 'all', updated = filters.updated ?? 'any'
  const sort = filters.sort === undefined ? 'recent' : filters.sort
  const filtered = boards.filter((board) => matchesTemplate(board, templates) && matchesAccess(board, access) && matchesUpdated(board, updated, now))
  return sortBoards(filtered, sort)
}

// Counts filters (not sort — that's an ordering preference, not something to
// "clear") that differ from their default, to drive the "Limpiar filtros" UI.
export function activeFilterCount(filters = DEFAULT_FILTERS) {
  let count = 0
  if (filters.templates?.length) count += 1
  if (filters.access && filters.access !== 'all') count += 1
  if (filters.updated && filters.updated !== 'any') count += 1
  return count
}

// Re-shapes server search results into board rows: only boards present in
// `results`, in the server's ranked order, each carrying its `matches`.
export function orderBySearch(boards, results) {
  const byId = new Map(boards.map((board) => [board.id, board]))
  return results
    .map((result) => {
      const board = byId.get(result.boardId)
      return board ? { ...board, matches: result.matches } : null
    })
    .filter(Boolean)
}
