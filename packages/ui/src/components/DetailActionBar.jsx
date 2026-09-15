import { MoreHorizontal } from "lucide-react";
import { Button } from "./Button.jsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./DropdownMenu.jsx";
import { cn } from "../lib/utils.js";

// A primary action button plus a "..." overflow menu for secondary/destructive
// actions, so a destructive action never competes visually with the primary
// one. Meant for RunlyDetail's `heroActions` slot.
//   primary   { label, onClick, icon? } | null
//   secondary [{ label, onClick, icon?, destructive? }]
export function DetailActionBar({ primary = null, secondary = [] }) {
  const items = (Array.isArray(secondary) ? secondary : []).filter(Boolean);

  return (
    <div className="flex items-center gap-2">
      {primary ? (
        <Button type="button" onClick={primary.onClick}>
          {primary.icon}
          {primary.label}
        </Button>
      ) : null}
      {items.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" size="icon" aria-label="Más acciones">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {items.map((item) => (
              <DropdownMenuItem
                key={item.label}
                onClick={item.onClick}
                className={cn(
                  item.destructive && "text-red-600 focus:text-red-600 dark:text-red-400",
                )}
              >
                {item.icon}
                {item.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
