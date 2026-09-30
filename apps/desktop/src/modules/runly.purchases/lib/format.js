import { toLocalIso } from '@runly/core'

const moneyCache = new Map()
function moneyFormatter(currency, compact) {
  const key = `${currency}:${compact ? 1 : 0}`
  if (!moneyCache.has(key)) {
    moneyCache.set(key, new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: currency || 'MXN',
      ...(compact ? { notation: 'compact', maximumFractionDigits: 1 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    }))
  }
  return moneyCache.get(key)
}

export const toNumber = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}
export const formatMoney = (value, currency = 'MXN') => moneyFormatter(currency, false).format(toNumber(value))
export const formatMoneyCompact = (value, currency = 'MXN') => moneyFormatter(currency, true).format(toNumber(value))
export const formatQty = (value) => new Intl.NumberFormat('es-MX', { maximumFractionDigits: 4 }).format(toNumber(value))

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
export const monthLabel = (key) => {
  const [y, m] = String(key).split('-')
  return `${MONTHS[Number(m) - 1] ?? m} ${String(y).slice(2)}`
}

// Dates arrive as 'YYYY-MM-DD' or ISO timestamps; date-only values are shown
// as calendar dates (no timezone shift).
export function formatDate(value) {
  if (!value) return 'Sin fecha'
  const text = String(value)
  const [y, m, d] = text.slice(0, 10).split('-')
  if (!y || !m || !d) return text
  return `${d} ${MONTHS[Number(m) - 1]} ${y}`
}
export const dateInput = (value) => (value ? String(value).slice(0, 10) : '')
export const today = () => toLocalIso()

export function daysUntil(value) {
  if (!value) return null
  const [y, m, d] = String(value).slice(0, 10).split('-').map(Number)
  const target = new Date(y, m - 1, d)
  const now = new Date()
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((target - base) / 86400000)
}

export const initials = (name) => String(name ?? '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?'
