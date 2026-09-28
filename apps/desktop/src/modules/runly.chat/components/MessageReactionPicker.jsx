import { Popover, PopoverAnchor, PopoverContent, Sheet, SheetContent, SheetHeader, SheetTitle, ThemedEmojiPicker, useCoarsePointer } from "@runly/ui";

// The full emoji picker for choosing a reaction outside the quick set. On a
// coarse pointer (phone) it opens as a bottom Sheet — WhatsApp-style, and the
// same pattern MessageComposer.jsx already uses for its own "+" — because a
// body-portaled Popover anchored to a bubble mispositions on small viewports
// (spilled off the top / behind the status bar). On desktop it stays a Radix
// Popover anchored beside the bubble. ThemedEmojiPicker repaints the library's
// palette with Atlas tokens so it reads as one surface with the sheet/popover.
//
// Opened externally (from the "+" in MessageActionSheet's quick-reaction pill),
// so `children` is the bubble-column element the desktop popover anchors to and
// must always render in place. `onPick(emoji)` receives the plain character.
export function MessageReactionPicker({ open, onOpenChange, onPick, anchorAlign = "start", children }) {
  const coarse = useCoarsePointer();

  if (coarse) {
    return (
      <>
        {children}
        <Sheet open={open} onOpenChange={onOpenChange}>
          <SheetContent
            side="bottom"
            // One uniform surface: drop the glass here so the header and the
            // (opaque) emoji grid don't read as two different panels.
            className="p-0 gap-0 border-t-0 bg-[hsl(var(--popover,var(--background)))]"
            style={{ zIndex: 10001 }}
          >
            <SheetHeader className="px-4 pt-3.5 pb-2">
              <SheetTitle className="text-sm">Reaccionar</SheetTitle>
            </SheetHeader>
            <ThemedEmojiPicker
              className="px-1.5 pb-1.5"
              onEmojiClick={(d) => { onPick(d.emoji); onOpenChange(false); }}
              width="100%"
              height="min(48vh, 400px)"
            />
          </SheetContent>
        </Sheet>
      </>
    );
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>{children}</PopoverAnchor>
      <PopoverContent
        side={anchorAlign === "end" ? "left" : "right"}
        align="start"
        sideOffset={8}
        // Keep the picker fully on-screen on narrow windows — without this the
        // fixed-width emoji panel spills past the viewport edge next to a wide
        // message bubble.
        collisionPadding={8}
        // pointer-events-auto + explicit high z-index: when opened from inside a
        // modal Sheet/Dialog (ThreadPanel "Hilo"), Radix Dialog sets
        // `pointer-events: none` on <body> and this Popover portals as a sibling.
        className="w-auto p-0 overflow-hidden pointer-events-auto bg-[hsl(var(--popover,var(--background)))]"
        style={{ zIndex: 10001 }}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <ThemedEmojiPicker
          onEmojiClick={(emojiData) => { onPick(emojiData.emoji); onOpenChange(false); }}
          width="min(92vw, 300px)"
          height="min(60vh, 320px)"
        />
      </PopoverContent>
    </Popover>
  );
}
