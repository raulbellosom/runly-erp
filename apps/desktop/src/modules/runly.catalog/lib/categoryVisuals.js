// apps/desktop/src/modules/runly.catalog/lib/categoryVisuals.js
// Deterministic (not random) per-category color — hashes the category name
// into a small palette so rows read as visually distinct at a glance, same
// approach as runly.ledger's account-visuals.js pickAvatarStyle.

const PALETTE = [
  { bg: 'bg-blue-500/15', fg: 'text-blue-600 dark:text-blue-400' },
  { bg: 'bg-violet-500/15', fg: 'text-violet-600 dark:text-violet-400' },
  { bg: 'bg-amber-500/15', fg: 'text-amber-600 dark:text-amber-400' },
  { bg: 'bg-emerald-500/15', fg: 'text-emerald-600 dark:text-emerald-400' },
  { bg: 'bg-rose-500/15', fg: 'text-rose-600 dark:text-rose-400' },
  { bg: 'bg-cyan-500/15', fg: 'text-cyan-600 dark:text-cyan-400' },
]

export function pickCategoryStyle(seed) {
  const str = String(seed ?? '')
  let hash = 0
  for (let i = 0; i < str.length; i += 1) hash = (hash * 31 + str.charCodeAt(i)) >>> 0
  return PALETTE[hash % PALETTE.length]
}
