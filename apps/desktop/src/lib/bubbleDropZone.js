// Shared "drag a floating bubble to the bottom-center to hide it" target, used
// by the chat bubble and the quick-notes bubble.
export const BUBBLE_DROP_RADIUS = 44;

export function bubbleDropZoneCenter(viewport) {
  return { x: viewport.width / 2, y: viewport.height - 52 };
}

export function isInBubbleDropZone(point, viewport) {
  const c = bubbleDropZoneCenter(viewport);
  return Math.hypot(point.x - c.x, point.y - c.y) < BUBBLE_DROP_RADIUS;
}
