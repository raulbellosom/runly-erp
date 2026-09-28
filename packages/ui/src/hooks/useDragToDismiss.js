import { useCallback, useRef, useState } from "react";

/**
 * Shared pointer-based drag gestures for mobile bottom-sheet-style overlays
 * (Dialog's mobile sheet, Sheet's bottom side), driven from the drag handle:
 *
 * - collapsed + drag down past `threshold`  → dismiss (hidden close ref click)
 * - collapsed + drag up past `expandThreshold` → expand to full screen
 * - expanded  + drag down past `threshold`  → back to the regular sheet
 *
 * While dragging, `dragY` is the signed offset and `baseHeight` the sheet
 * height at pointer-down, so the style helper can grow/shrink the sheet with
 * the finger. `surfaceRef` must be attached to the sheet surface: it resets
 * the expanded state whenever the sheet unmounts (closes).
 */
export function useDragToDismiss({ threshold = 80, expandThreshold = 60 } = {}) {
  const closeRef = useRef(null);
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [baseHeight, setBaseHeight] = useState(null);
  const dragStartY = useRef(null);
  const isDragging = useRef(false);
  // Mirrors of dragY / baseHeight for the pointer handlers: a fast flick can
  // fire pointerup before React re-renders with the last move's state.
  const dragYRef = useRef(0);
  const baseHeightRef = useRef(null);

  // Hosts compose this into a ref callback that may be recreated every render,
  // and React then calls the old callback with null right before the new one
  // with the same node. Only a null that is NOT followed by a node within the
  // same commit means the sheet really closed; resetting on every null snapped
  // an expanded sheet back down on the next render.
  const surfaceNode = useRef(null);
  const surfaceRef = useCallback((node) => {
    surfaceNode.current = node;
    if (node) return;
    queueMicrotask(() => {
      if (!surfaceNode.current) setExpanded(false);
    });
  }, []);

  function handleDragPointerDown(e) {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStartY.current = e.clientY;
    isDragging.current = true;
    const surface = e.currentTarget.closest?.('[role="dialog"]');
    baseHeightRef.current = surface ? surface.getBoundingClientRect().height : null;
    dragYRef.current = 0;
    setBaseHeight(baseHeightRef.current);
    setDragging(true);
  }

  function handleDragPointerMove(e) {
    if (!isDragging.current || dragStartY.current === null) return;
    const dy = e.clientY - dragStartY.current;
    // Expanded sheets can't grow further; collapsed ones only grow upward
    // when we know their starting height.
    const next = expanded || baseHeightRef.current == null ? Math.max(0, dy) : dy;
    dragYRef.current = next;
    setDragY(next);
  }

  function handleDragPointerUp() {
    if (!isDragging.current) return;
    isDragging.current = false;
    setDragging(false);
    const dragY = dragYRef.current;
    if (expanded) {
      if (dragY > threshold) setExpanded(false);
    } else if (dragY > threshold) {
      closeRef.current?.click();
    } else if (dragY < -expandThreshold) {
      setExpanded(true);
    }
    dragYRef.current = 0;
    baseHeightRef.current = null;
    setDragY(0);
    setBaseHeight(null);
    dragStartY.current = null;
  }

  return {
    closeRef,
    surfaceRef,
    dragY,
    dragging,
    expanded,
    baseHeight,
    handleDragPointerDown,
    handleDragPointerMove,
    handleDragPointerUp,
  };
}
