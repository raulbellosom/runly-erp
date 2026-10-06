import { X } from "lucide-react";
import { cn } from "@runly/ui";

// Bottom-center "drop here to hide" target shown while a floating bubble is
// being dragged (see lib/bubbleDropZone.js for the hit test).
export function BubbleDropZone({ active, label, zIndex }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed bottom-4 left-1/2 flex -translate-x-1/2 flex-col items-center gap-1"
      style={{ zIndex }}
    >
      <div
        className={cn(
          "flex items-center justify-center rounded-full transition-all duration-150",
          active
            ? "h-16 w-16 scale-110 bg-red-500/90 shadow-lg shadow-red-500/40"
            : "h-12 w-12 bg-black/50 backdrop-blur-sm",
        )}
      >
        <X className={cn("text-white transition-all duration-150", active ? "h-7 w-7" : "h-5 w-5")} />
      </div>
      <span
        className={cn(
          "text-[10px] font-medium text-white drop-shadow transition-opacity duration-150",
          active ? "opacity-100" : "opacity-60",
        )}
      >
        {label}
      </span>
    </div>
  );
}
