import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "../lib/utils.js";

// Canonical mobile bottom-sheet geometry shared by Dialog.jsx (its mobile
// variant) and Sheet.jsx (side="bottom", and right/left panels on mobile).
// This file is THE base for every mobile modal/sheet in the platform — do not
// hand-roll another bottom sheet; extend this one instead.
//
// Layout contract:
// - The surface itself never scrolls (`overflow-hidden`; each host makes it a
//   flex column on mobile so <BottomSheetBody> can fill it). The
//   drag handle and the close button are absolutely positioned against it, so
//   they always stay visible at the top.
// - `pt-9!` reserves room under the drag handle. It is `!important` so a
//   consumer passing `p-0` can no longer push its header under the handle.
// - All consumer content goes through <BottomSheetBody>, the only scroll
//   region. SheetHeader / DialogHeader are sticky inside it, so a header that
//   lives in the scrolling flow still stays pinned at the top.
// - `min-h-[50dvh]` → the sheet always covers at least half the screen
//   instead of hugging tiny content.
// - On mobile the surface is opaque (--card) so the sticky header can use the
//   exact same color: a translucent header stacked on the translucent glass
//   surface rendered as a visibly lighter band.
export const BOTTOM_SHEET_SURFACE_CLASS =
  "overflow-hidden rounded-t-2xl px-6 pt-9! pb-6 min-h-[50dvh] max-h-[85dvh] max-md:bg-[hsl(var(--card))]!";

// Mobile-only sticky header behavior for SheetHeader / DialogHeader. Has no
// effect when the header already sits outside the scroll region. Its
// background matches the opaque surface so it never reads as a separate band.
export const BOTTOM_SHEET_STICKY_HEADER_CLASS =
  "max-md:sticky max-md:top-0 max-md:z-10 max-md:bg-[hsl(var(--card))]";

const SHEET_EASING = "280ms cubic-bezier(0.32, 0.72, 0, 1)";

// Inline geometry for the bottom sheet. Drag fields come from
// useDragToDismiss(); `keyboard` from useKeyboardViewport().
// - Keyboard open: the sheet sits on top of it (iOS keeps `bottom: 0` behind
//   the keyboard) and is capped to the visible viewport so the header stays
//   on screen.
// - Expanded (dragged up from the handle): full screen minus the top safe
//   area, square top corners; it stays there until dragged back down.
// - While dragging up (or down from expanded) the height follows the finger;
//   dragging a collapsed sheet down translates it toward dismissal.
export function bottomSheetDragStyle({
  dragY,
  dragging,
  expanded = false,
  baseHeight = null,
  style,
  keyboard,
}) {
  const keyboardOpen = keyboard?.inset > 0 && keyboard.visibleHeight;
  const fullHeight = keyboardOpen
    ? `${Math.round(keyboard.visibleHeight)}px`
    : "calc(100dvh - env(safe-area-inset-top, 0px))";
  const resizing =
    dragging && baseHeight != null && (dragY < 0 || (expanded && dragY > 0));

  let sizing = null;
  if (resizing) {
    sizing = {
      height: `min(${Math.round(baseHeight - dragY)}px, ${fullHeight})`,
      maxHeight: fullHeight,
      minHeight: 0,
    };
  } else if (expanded) {
    sizing = {
      height: fullHeight,
      maxHeight: fullHeight,
      borderTopLeftRadius: 0,
      borderTopRightRadius: 0,
    };
  } else if (keyboardOpen) {
    const cap = Math.round(keyboard.visibleHeight - 12);
    sizing = { maxHeight: `${cap}px`, minHeight: `min(50dvh, ${cap}px)` };
  }

  return {
    paddingBottom: keyboardOpen
      ? "1rem"
      : "calc(1.5rem + env(safe-area-inset-bottom, 0px))",
    ...(keyboardOpen ? { bottom: `${keyboard.inset}px` } : null),
    ...sizing,
    transform: !expanded && dragY > 0 ? `translateY(${dragY}px)` : undefined,
    transition: dragging
      ? "none"
      : `transform ${SHEET_EASING}, height ${SHEET_EASING}, border-radius ${SHEET_EASING}`,
    ...style,
  };
}

const EDITABLE_SELECTOR = "input, textarea, select, [contenteditable='true']";

// Once the keyboard has opened and the sheet has been lifted, bring the
// focused field to the middle of the scroll region so neither the keyboard
// nor the OS autofill/accessory bar sits on top of it.
function revealFocusedField(event) {
  const target = event.target;
  if (!target?.matches?.(EDITABLE_SELECTOR)) return;
  if (!window.matchMedia?.("(pointer: coarse)")?.matches) return;
  window.setTimeout(() => {
    if (document.activeElement !== target) return;
    target.scrollIntoView?.({ block: "center", behavior: "smooth" });
  }, 320);
}

// The single scroll region of a bottom sheet. Inherits the surface's gap so
// consumers that space children with `gap-*` on the content keep their layout.
export function BottomSheetBody({ className, children }) {
  return (
    <div
      onFocus={revealFocusedField}
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-[inherit] overflow-y-auto overscroll-contain touch-pan-y",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function BottomSheetHandle({
  closeRef,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}) {
  return (
    <>
      {/* Generous, transparent grab zone pinned to the sheet's top edge —
          not the 6px pill alone, which was almost impossible to hit so the
          drag-to-dismiss gesture "did nothing". Centered and narrow so it
          never sits over the top-right close button. The visible pill is
          centered inside it, landing roughly level with that close button. */}
      <div
        className="absolute left-1/2 top-0 z-20 flex h-9 w-28 -translate-x-1/2 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
        aria-hidden="true"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="h-1.5 w-12 rounded-full bg-foreground/25" />
      </div>
      {/* Hidden close button for programmatic swipe-to-dismiss. Both Dialog
          and Sheet are built on @radix-ui/react-dialog, so this Close works
          inside either one's Content tree. */}
      <DialogPrimitive.Close
        ref={closeRef}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
      />
    </>
  );
}
