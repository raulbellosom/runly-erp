// apps/desktop/src/modules/runly.catalog/lib/formatCurrency.js
export function formatCurrency(amount, currency = 'USD') {
  const value = Number(amount ?? 0)
  const code = currency && /^[A-Z]{3}$/i.test(currency) ? currency.toUpperCase() : 'USD'
  try {
    return value.toLocaleString('es-MX', { style: 'currency', currency: code })
  } catch {
    return value.toLocaleString('es-MX', { style: 'currency', currency: 'USD' })
  }
}
