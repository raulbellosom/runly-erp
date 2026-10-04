import { forwardRef, useRef } from "react";
import * as SheetPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cva } from "class-variance-authority";
import { cn } from "../lib/utils.js";
import { useDragToDismiss } from "../hooks/useDragToDismiss.js";
import { useIsMobile } from "../hooks/useIsMobile.js";
import { useKeyboardViewport } from "../hooks/useKeyboardInset.js";
import {
  BOTTOM_SHEET_SURFACE_CLASS,
  BOTTOM_SHEET_STICKY_HEADER_CLASS,
  bottomSheetDragStyle,
  BottomSheetBody,
  BottomSheetHandle,
} from "./bottom-sheet-shared.jsx";
import { OverlaySurfaceContext } from "./overlay-surface-context.js";

const Sheet = SheetPrimitive.Root;
const SheetTrigger = SheetPrimitive.Trigger;
const SheetClose = SheetPrimitive.Close;
const SheetPortal = SheetPrimitive.Portal;

const SheetOverlay = forwardRef(function SheetOverlay(
  { className, ...props },
  ref,
) {
  return (
    <SheetPrimitive.Overlay
      className={cn(
        "fixed inset-0 z-50 overlay-scrim",
        "data-[state=open]:animate-in data-[state=closed]:animate-out",
        "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        className,
      )}
      {...props}
      ref={ref}
    />
  );
});

const sheetVariants = cva(
  "fixed z-50 glass-strong flex flex-col gap-4 p-6 shadow-lg transition ease-in-out data-[state=closed]:duration-200 data-[state=open]:duration-300 focus:outline-none",
  {
    variants: {
      side: {
        top: "inset-x-0 top-0 rounded-b-2xl data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
        bottom:
          "inset-x-0 bottom-0 sm:mx-auto sm:max-w-lg data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
        left: "inset-y-0 left-0 h-full w-3/4 rounded-r-2xl data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-sm",
        right:
          "inset-y-0 right-0 h-full w-3/4 rounded-l-2xl data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-sm",
      },
    },
    defaultVariants: {
      side: "right",
    },
  },
);

const SheetContent = forwardRef(function SheetContent(
  {
    side = "right",
    className,
    style,
    children,
    "aria-describedby": ariaDescribedby,
    onOpenAutoFocus,
    ...props
  },
  forwardedRef,
) {
  const isMobile = useIsMobile();
  const effectiveSide =
    isMobile && (side === "right" || side === "left") ? "bottom" : side;
  const isBottom = effectiveSide === "bottom";
  const keyboard = useKeyboardViewport({ enabled: isBottom });
  // On phones a bottom sheet always spans the full viewport width, whatever
  // width/maxWidth the consumer sized its desktop side panel with.
  const surfaceStyle =
    isBottom && isMobile && style
      ? (({ width: _w, maxWidth: _mw, minWidth: _minW, ...rest }) => rest)(style)
      : style;

  const contentRef = useRef(null);
  const {
    closeRef,
    surfaceRef,
    dragY,
    dragging,
    expanded,
    baseHeight,
    handleDragPointerDown,
    handleDragPointerMove,
    handleDragPointerUp,
  } = useDragToDismiss();

  function setRef(node) {
    contentRef.current = node;
    surfaceRef(node);
    if (typeof forwardedRef === "function") forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  }

  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        ref={setRef}
        aria-describedby={ariaDescribedby}
        tabIndex={-1}
        onOpenAutoFocus={(e) => {
          if (onOpenAutoFocus) {
            onOpenAutoFocus(e);
          } else {
            e.preventDefault();
            contentRef.current?.focus();
          }
        }}
        className={cn(
          sheetVariants({ side: effectiveSide }),
          isBottom && BOTTOM_SHEET_SURFACE_CLASS,
          // On non-bottom panels (right/left/top) clip overflow so children can
          // use flex-1 / min-h-0 to fill the panel height without causing scroll
          // on the panel itself.
          effectiveSide !== "bottom" && "overflow-hidden",
          className,
          isBottom && isMobile && "w-full! max-w-none!",
        )}
        {...props}
        style={
          isBottom
            ? bottomSheetDragStyle({
                dragY,
                dragging,
                expanded,
                baseHeight,
                style: surfaceStyle,
                keyboard,
              })
            : effectiveSide === "right" || effectiveSide === "left"
            ? {
                paddingTop: "calc(1.5rem + env(safe-area-inset-top, 0px))",
                paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom, 0px))",
                ...style,
              }
            : effectiveSide === "top"
            ? { paddingTop: "calc(1.5rem + env(safe-area-inset-top, 0px))", ...style }
            : style
        }
      >
        {/* Drag handle — visible only on bottom sheet; handles swipe-to-dismiss */}
        {isBottom && (
          <BottomSheetHandle
            closeRef={closeRef}
            onPointerDown={handleDragPointerDown}
            onPointerMove={handleDragPointerMove}
            onPointerUp={handleDragPointerUp}
          />
        )}
        <SheetPrimitive.Close className="absolute right-4 top-4 z-20 rounded-lg p-1 text-[hsl(var(--muted-foreground))] opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]/40">
          <X className="h-4 w-4" />
          <span className="sr-only">Cerrar</span>
        </SheetPrimitive.Close>
        <OverlaySurfaceContext.Provider value={true}>
          {isBottom ? <BottomSheetBody>{children}</BottomSheetBody> : children}
        </OverlaySurfaceContext.Provider>
      </SheetPrimitive.Content>
    </SheetPortal>
  );
});

const SheetHeader = function SheetHeader({ className, ...props }) {
  return (
    <div
      className={cn(
        "flex shrink-0 flex-col gap-1.5",
        BOTTOM_SHEET_STICKY_HEADER_CLASS,
        className,
      )}
      {...props}
    />
  );
};

const SheetFooter = function SheetFooter({ className, ...props }) {
  return (
    <div
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end mt-auto",
        className,
      )}
      {...props}
    />
  );
};

const SheetTitle = forwardRef(function SheetTitle(
  { className, ...props },
  ref,
) {
  return (
    <SheetPrimitive.Title
      ref={ref}
      className={cn("text-base font-semibold", className)}
      {...props}
    />
  );
});

const SheetDescription = forwardRef(function SheetDescription(
  { className, ...props },
  ref,
) {
  return (
    <SheetPrimitive.Description
      ref={ref}
      className={cn("text-sm text-[hsl(var(--muted-foreground))]", className)}
      {...props}
    />
  );
});

export {
  Sheet,
  SheetPortal,
  SheetOverlay,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
};
