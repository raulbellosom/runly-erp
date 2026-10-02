// Visual style per PosTable status — colors, ring width and labels shown on
// the waiter floor view. Shared by the Canvas-engine table drawer
// (floorDrawers.js); moved verbatim from the old operational canvas component.
export const TABLE_STATUS_STYLE = {
  AVAILABLE:      { ring: '#16a34a', fill: 'rgba(220,252,231,0.97)', ringWidth: 2,   label: 'Disponible',   dot: '#22c55e', textColor: '#14532d' },
  OCCUPIED:       { ring: '#d97706', fill: 'rgba(254,243,199,0.97)', ringWidth: 2.5, label: 'Ocupada',      dot: '#f59e0b', textColor: '#78350f' },
  BILL_REQUESTED: { ring: '#ea580c', fill: 'rgba(255,237,213,0.97)', ringWidth: 3,   label: 'Cuenta',       dot: '#f97316', textColor: '#7c2d12' },
  DIRTY:          { ring: '#64748b', fill: 'rgba(241,245,249,0.97)', ringWidth: 1.5, label: 'Sucia',        dot: '#94a3b8', textColor: '#334155' },
  RESERVED:       { ring: '#2563eb', fill: 'rgba(219,234,254,0.97)', ringWidth: 2,   label: 'Reservada',    dot: '#3b82f6', textColor: '#1e3a8a' },
  DISABLED:       { ring: '#cbd5e1', fill: 'rgba(248,250,252,0.80)', ringWidth: 1,   label: 'No disponible',dot: '#cbd5e1', textColor: '#94a3b8' },
}

export const DEFAULT_STATUS = TABLE_STATUS_STYLE.AVAILABLE
