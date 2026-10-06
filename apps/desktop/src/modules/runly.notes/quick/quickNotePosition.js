// Pure geometry for the floating quick-notes panel/bubble (unit-tested).
export const QUICK_NOTE_MARGIN = 12;

// Keeps a box of `size` fully inside the viewport, with a margin.
export function clampToViewport(pos, size, viewport, margin = QUICK_NOTE_MARGIN) {
  const maxX = Math.max(margin, viewport.width - size.width - margin);
  const maxY = Math.max(margin, viewport.height - size.height - margin);
  return {
    x: Math.min(Math.max(pos.x, margin), maxX),
    y: Math.min(Math.max(pos.y, margin), maxY),
  };
}

// Default spot: bottom-right, left of the chat bubble column.
export function defaultPosition(size, viewport) {
  return clampToViewport(
    { x: viewport.width - size.width - 96, y: viewport.height - size.height - 24 },
    size,
    viewport,
  );
}

// Bubble release: stick to the nearer side edge (like the chat bubble), keep
// the vertical position.
export function snapToEdge(pos, size, viewport, margin = QUICK_NOTE_MARGIN) {
  const centerX = pos.x + size.width / 2;
  const x = centerX > viewport.width / 2 ? viewport.width - size.width - margin : margin;
  return clampToViewport({ x, y: pos.y }, size, viewport, margin);
}

// True once the pointer moved past the drag threshold (bigger on touch).
export function passedDragThreshold(start, point, pointerType) {
  const threshold = pointerType === "touch" ? 10 : 4;
  return Math.abs(point.x - start.x) > threshold || Math.abs(point.y - start.y) > threshold;
}

// Ctrl+Alt+N (Cmd+Option+N on macOS). Uses e.code so it works on any layout.
export function isQuickNoteShortcut(e) {
  return Boolean((e.ctrlKey || e.metaKey) && e.altKey && !e.shiftKey && e.code === "KeyN");
}
