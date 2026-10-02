// Fill/stroke colors for POLYGON and FLOOR_ZONE decor, keyed by the zone
// "color" style field. Shared by the planner (FloorCanvasDecor.jsx, which
// re-exports this) and the Canvas-engine floor drawers (floorDrawers.js).
export const POLYGON_ZONE_COLORS = {
  neutral: { fill: 'rgba(100,116,139,0.12)', stroke: '#64748b' },
  dining:  { fill: 'rgba(59,130,246,0.12)',  stroke: '#3b82f6' },
  outdoor: { fill: 'rgba(34,197,94,0.12)',   stroke: '#22c55e' },
  bar:     { fill: 'rgba(245,158,11,0.12)',  stroke: '#f59e0b' },
  vip:     { fill: 'rgba(139,92,246,0.12)',  stroke: '#8b5cf6' },
  private: { fill: 'rgba(239,68,68,0.12)',   stroke: '#ef4444' },
}
