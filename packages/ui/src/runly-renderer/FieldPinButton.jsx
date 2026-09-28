import { Pin, PinOff } from "lucide-react";
import { cn } from "../lib/utils.js";

// Pin toggle drawn over a RunlyForm field (or component section) when the form
// receives `fieldPins`. Pinned fields always show a filled pin; unpinned ones
// only while pin mode is on (`fieldPins.visible`).
export function FieldPinButton({ pinned, visible, label, onToggle }) {
  if (!pinned && !visible) return null;
  const title = pinned ? `Dejar de fijar ${label}` : `Fijar ${label}`;
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={!visible}
      title={title}
      aria-label={title}
      aria-pressed={pinned}
      className={cn(
        "absolute right-0 top-0 z-10 flex h-6 w-6 items-center justify-center rounded-md transition-colors",
        pinned
          ? "bg-[hsl(var(--primary))]/15 text-[hsl(var(--primary))]"
          : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]",
        visible ? "cursor-pointer" : "cursor-default",
      )}
    >
      {pinned && visible ? <PinOff className="h-3.5 w-3.5" /> : <Pin className={cn("h-3.5 w-3.5", pinned && "fill-current")} />}
    </button>
  );
}

// fieldPins contract: { pinned: string[], visible: boolean, canPin?(name) => boolean, onToggle(names: string[], pin: boolean) }
export function pinStateFor(fieldPins, names) {
  if (!fieldPins) return null;
  const pinnable = names.filter((name) => fieldPins.canPin?.(name) ?? true);
  if (!pinnable.length) return null;
  const pinned = pinnable.every((name) => fieldPins.pinned?.includes(name));
  return { pinned, visible: Boolean(fieldPins.visible), onToggle: () => fieldPins.onToggle(pinnable, !pinned) };
}
