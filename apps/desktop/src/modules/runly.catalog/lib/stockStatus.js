// apps/desktop/src/modules/runly.catalog/lib/stockStatus.js
//
// Must match LOW_STOCK_THRESHOLD in apps/api/src/routes/catalog/catalog-product-service.js
// so the list, detail and inventory views agree on what counts as "low stock".
export const LOW_STOCK_THRESHOLD = 10

export function getStockStatus({ trackStock, stock }) {
  if (!trackStock) return 'ok'
  if (stock <= 0) return 'out'
  if (stock <= LOW_STOCK_THRESHOLD) return 'low'
  return 'ok'
}

export const STOCK_STATUS_META = {
  ok:  { label: 'Stock optimo', tone: 'success' },
  low: { label: 'Stock bajo',   tone: 'warning' },
  out: { label: 'Agotado',      tone: 'destructive' },
}
