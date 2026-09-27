// apps/desktop/src/modules/runly.catalog/lib/aggregateMovements.js

// Buckets real stock movements (quantity_delta) into per-month totals. This
// reflects inventory volume (entradas/salidas), not revenue — the catalog
// module has no order/sale price tied to a movement, so a "ventas" chart
// would have to fabricate numbers. Entradas/Salidas is the honest signal.
export function aggregateMovementsByMonth(movements) {
  const map = new Map()
  for (const m of movements ?? []) {
    const month = String(m.created_at ?? '').slice(0, 7)
    if (!month) continue
    if (!map.has(month)) map.set(month, { month, entradas: 0, salidas: 0 })
    const bucket = map.get(month)
    const delta = Number(m.quantity_delta ?? 0)
    if (delta >= 0) bucket.entradas += delta
    else bucket.salidas += Math.abs(delta)
  }
  return [...map.values()].sort((a, b) => a.month.localeCompare(b.month))
}

export function formatMonthLabel(month) {
  const [y, m] = String(month).split('-')
  if (!y || !m) return month
  const date = new Date(Number(y), Number(m) - 1, 1)
  return date.toLocaleDateString('es-MX', { month: 'short', year: '2-digit' })
}
