import { useCallback, useEffect, useRef } from "react";

/**
 * Keeps mouse-wheel / trackpad / touch scrolling alive inside popups that are
 * rendered in a portal (position:fixed dropdowns, Radix Popover / DropdownMenu
 * content, mention menus, icon pickers, ...).
 *
 * Root cause this works around:
 *   `@radix-ui/react-dialog` (our <Dialog> and <Sheet>) wraps its subtree in
 *   <RemoveScroll shards={[contentRef]}> from `react-remove-scroll`. That
 *   library registers a NON-passive, bubble-phase `wheel` / `touchmove`
 *   listener on `document` and calls `preventDefault()` for every scroll
 *   gesture whose target is not inside the dialog content node (or a
 *   registered shard). A popup portaled to `document.body` is neither, so
 *   every wheel tick over it gets cancelled — the list looks "frozen" even
 *   though dragging the scrollbar and arrow keys still work.
 *
 * Fix: attach bubble-phase listeners on the portaled node that call
 * `stopPropagation()`, so the event never reaches react-remove-scroll's
 * document listener. We never call `preventDefault()`, so native scrolling of
 * the popup behaves exactly as usual. Pair with `overscroll-contain` on the
 * scroll container so a boundary wheel does not chain to the page behind.
 *
 * @param {{ current: HTMLElement | null }} ref - ref to the portaled root node
 * @param {boolean} [active=true] - pass the popup's open state when the portal
 *   mounts/unmounts without the host component remounting
 */
export function isolateScroll(node) {
  if (!node) return () => {};
  const stop = (event) => event.stopPropagation();
  const opts = { passive: true };
  node.addEventListener("wheel", stop, opts);
  node.addEventListener("touchstart", stop, opts);
  node.addEventListener("touchmove", stop, opts);
  return () => {
    node.removeEventListener("wheel", stop, opts);
    node.removeEventListener("touchstart", stop, opts);
    node.removeEventListener("touchmove", stop, opts);
  };
}

export function useIsolatedScroll(ref, active = true) {
  useEffect(() => {
    if (!active) return undefined;
    return isolateScroll(ref?.current);
  }, [ref, active]);
}

/**
 * Callback-ref variant for Radix content components (Popover, DropdownMenu,
 * ContextMenu). Their content node only mounts while open, long after the
 * wrapper component's first effect ran, so `useIsolatedScroll(ref)` there saw
 * `ref.current === null` and never attached its listeners — wheel/touch
 * scrolling stayed frozen inside dialogs and sheets. This attaches when the
 * node mounts and detaches when it unmounts.
 */
export function useIsolatedScrollRef() {
  const cleanupRef = useRef(null);
  return useCallback((node) => {
    cleanupRef.current?.();
    cleanupRef.current = node ? isolateScroll(node) : null;
  }, []);
}
