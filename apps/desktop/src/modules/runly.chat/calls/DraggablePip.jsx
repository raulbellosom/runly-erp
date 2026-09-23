import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Minus, Video } from "lucide-react";

const TAP_THRESHOLD_PX = 4;

// Floating, draggable, collapsible tile for the in-call overlay. Kept here
// rather than in @runly/ui because it is call-specific: it clamps to the call
// <main> and lives inside the fixed call overlay's stacking context. Drag uses
// Pointer Events so mouse and touch share one code path.
export function DraggablePip({
  children,
  label = "",
  initial = "?",
  anchorOffset = 0,
  className = "",
  // Called on a plain tap/click that wasn't a drag — used by the 1:1 focus
  // layout to swap which participant is big vs. small (WhatsApp-style).
  onTap = null,
}) {
  const nodeRef = useRef(null);
  const dragRef = useRef(null); // { pointerId, startX, startY, originX, originY, moved }
  const [pos, setPos] = useState(null); // { x, y } px from parent top-left; null = use CSS anchor
  const [collapsed, setCollapsed] = useState(false);

  const clampToParent = useCallback((x, y) => {
    const node = nodeRef.current;
    const parent = node?.offsetParent;
    if (!node || !parent) return { x, y };
    const maxX = Math.max(0, parent.clientWidth - node.offsetWidth);
    const maxY = Math.max(0, parent.clientHeight - node.offsetHeight);
    return {
      x: Math.min(Math.max(0, x), maxX),
      y: Math.min(Math.max(0, y), maxY),
    };
  }, []);

  // Keep the tile fully on-screen after it collapses/expands (its size changes)
  // or the window resizes. Returns the same object reference when nothing moved
  // so React bails out — no wasted render, no loop.
  const reclamp = useCallback(() => {
    setPos((current) => {
      if (!current) return current;
      const next = clampToParent(current.x, current.y);
      return next.x === current.x && next.y === current.y ? current : next;
    });
  }, [clampToParent]);

  useLayoutEffect(() => {
    reclamp();
  }, [collapsed, reclamp]);

  useEffect(() => {
    window.addEventListener("resize", reclamp);
    return () => window.removeEventListener("resize", reclamp);
  }, [reclamp]);

  const onPointerDown = (event) => {
    if (event.button != null && event.button !== 0) return;
    const node = nodeRef.current;
    const parent = node?.offsetParent;
    if (!node || !parent) return;
    const parentRect = parent.getBoundingClientRect();
    const originX = pos ? pos.x : node.offsetLeft;
    const originY = pos ? pos.y : node.offsetTop;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX,
      originY,
      parentRect,
      moved: false,
    };
    node.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) > TAP_THRESHOLD_PX) drag.moved = true;
    if (!drag.moved) return;
    setPos(clampToParent(drag.originX + dx, drag.originY + dy));
  };

  const endDrag = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    nodeRef.current?.releasePointerCapture?.(event.pointerId);
    dragRef.current = null;
  };

  const wasDrag = () => Boolean(dragRef.current?.moved);

  const baseStyle = pos
    ? { left: `${pos.x}px`, top: `${pos.y}px`, right: "auto", bottom: "auto" }
    : {
        right: `calc(0.75rem + env(safe-area-inset-right, 0px) + ${anchorOffset}px)`,
        bottom: `calc(0.75rem + env(safe-area-inset-bottom, 0px) + ${anchorOffset}px)`,
      };

  if (collapsed) {
    return (
      <button
        ref={nodeRef}
        type="button"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => {
          if (!wasDrag()) setCollapsed(false);
          endDrag(e);
        }}
        onPointerCancel={endDrag}
        style={baseStyle}
        title={label ? `Mostrar cámara de ${label}` : "Mostrar cámara"}
        className="absolute z-20 flex touch-none select-none items-center gap-2 rounded-full bg-slate-900/90 px-3 py-2 text-xs font-medium text-white shadow-2xl ring-1 ring-white/20 backdrop-blur"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-violet-500/30 text-[0.7rem] font-semibold text-violet-100">
          {initial}
        </span>
        <Video className="h-4 w-4 text-white/80" />
      </button>
    );
  }

  return (
    <div
      ref={nodeRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => { if (!wasDrag()) onTap?.(); endDrag(e); }}
      onPointerCancel={endDrag}
      style={baseStyle}
      className={`absolute z-20 aspect-[3/4] w-[34%] max-w-56 touch-none select-none overflow-hidden rounded-2xl shadow-2xl ring-1 ring-white/20 sm:aspect-video sm:w-[28%] ${className}`}
    >
      {children}
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        onClick={() => setCollapsed(true)}
        title="Ocultar"
        className="absolute right-1.5 top-1.5 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-black/50 text-white/90 ring-1 ring-white/20 backdrop-blur transition hover:bg-black/70"
      >
        <Minus className="h-4 w-4" />
      </button>
    </div>
  );
}
