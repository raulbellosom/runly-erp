// apps/desktop/src/modules/runly.ledger/lib/account-visuals.js
// Deterministic (not random) per-account visual variety — hashes a seed
// (the bank name) into a small palette so cards for different banks read as
// visually distinct at a glance, without inventing any account data.

const AVATAR_PALETTE = [
  { bg: 'bg-blue-500/15', fg: 'text-blue-600 dark:text-blue-400', border: 'border-blue-500/60' },
  { bg: 'bg-violet-500/15', fg: 'text-violet-600 dark:text-violet-400', border: 'border-violet-500/60' },
  { bg: 'bg-amber-500/15', fg: 'text-amber-600 dark:text-amber-400', border: 'border-amber-500/60' },
  { bg: 'bg-emerald-500/15', fg: 'text-emerald-600 dark:text-emerald-400', border: 'border-emerald-500/60' },
  { bg: 'bg-rose-500/15', fg: 'text-rose-600 dark:text-rose-400', border: 'border-rose-500/60' },
  { bg: 'bg-cyan-500/15', fg: 'text-cyan-600 dark:text-cyan-400', border: 'border-cyan-500/60' },
]

export function pickAvatarStyle(seed) {
  const str = String(seed ?? '')
  let hash = 0
  for (let i = 0; i < str.length; i += 1) hash = (hash * 31 + str.charCodeAt(i)) >>> 0
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length]
}

// Splits a formatted currency string at the decimal point so callers can
// render the integer part larger than the cents — e.g. "$148,250" + ".00".
export function splitCurrency(value, currency = 'MXN') {
  const formatted = Number(value ?? 0).toLocaleString('es-MX', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  })
  const dotIndex = formatted.lastIndexOf('.')
  if (dotIndex === -1) return { intPart: formatted, decPart: '00' }
  return { intPart: formatted.slice(0, dotIndex), decPart: formatted.slice(dotIndex + 1) }
}
