// Geometry for the mobile corner menu: pulling from the bottom-left corner
// fans two quarter-circle rings of options out of the corner. Direction picks
// the item, distance picks the ring. Pure functions, unit-tested.

export const CORNER_RINGS = [
  { id: "inner", radius: 96, max: 3 },
  { id: "outer", radius: 172, max: 5 },
];
// Below this distance from the corner nothing is selected (release = cancel).
export const CORNER_DEAD_ZONE = 48;
// Angular padding at both ends of the 0-90 degree arc, so edge items are not
// glued to the screen edges.
const ARC_PAD_DEG = 8;

// Angle of item `index` among `count` on a ring: 90deg = straight up, 0 = right.
export function itemAngle(index, count) {
  const span = 90 - ARC_PAD_DEG * 2;
  if (count <= 1) return 45;
  return 90 - ARC_PAD_DEG - (span * index) / (count - 1);
}

// Item center relative to the corner origin (screen coordinates, y grows down).
export function itemOffset(index, count, radius) {
  const a = (itemAngle(index, count) * Math.PI) / 180;
  return { x: Math.round(radius * Math.cos(a)), y: Math.round(-radius * Math.sin(a)) };
}

// Which ring + item a finger at (dx, dy) from the corner points to, or null.
// `counts` is the number of items on each ring ([inner, outer]).
export function pickCornerItem(dx, dy, counts) {
  const dist = Math.hypot(dx, dy);
  if (dist < CORNER_DEAD_ZONE) return null;
  const [inner, outer] = CORNER_RINGS;
  const boundary = (inner.radius + outer.radius) / 2;
  let ring = dist < boundary ? 0 : 1;
  // A ring with no items hands the selection to the other one.
  if (!counts[ring]) ring = ring === 0 ? 1 : 0;
  const count = counts[ring];
  if (!count) return null;
  const angle = Math.min(90, Math.max(0, (Math.atan2(-dy, dx) * 180) / Math.PI));
  let best = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < count; i++) {
    const diff = Math.abs(itemAngle(i, count) - angle);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  }
  return { ring, index: best };
}

// Outer ring: favorites first, then recents, without duplicates.
export function buildFavoriteSlots(modules, favoriteKeys, recentKeys, max = CORNER_RINGS[1].max) {
  const byKey = new Map(modules.map((m) => [m.key, m]));
  const out = [];
  for (const key of [...favoriteKeys, ...recentKeys]) {
    const m = byKey.get(key);
    if (m && !out.includes(m)) out.push(m);
    if (out.length >= max) break;
  }
  return out;
}
