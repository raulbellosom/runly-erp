import { Button } from "./Button.jsx";
import { cn } from "../lib/utils.js";

// A primary action button plus visible secondary/destructive action buttons,
// all shown directly (no overflow menu — users should see every action at a
// glance rather than hunt for one behind a "...").  Meant for RunlyDetail's
// `heroActions` slot.
//   primary   { label, onClick, icon? } | null
//   secondary [{ label, onClick, icon?, destructive? }]
export function DetailActionBar({ primary = null, secondary = [] }) {
  const items = (Array.isArray(secondary) ? secondary : []).filter(Boolean);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {items.map((item) => (
        <Button
          key={item.label}
          type="button"
          variant="outline"
          onClick={item.onClick}
          className={cn(
            item.destructive &&
              "text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:border-red-900/60 dark:hover:bg-red-950/40",
          )}
        >
          {item.icon}
          {item.label}
        </Button>
      ))}
      {primary ? (
        <Button type="button" onClick={primary.onClick}>
          {primary.icon}
          {primary.label}
        </Button>
      ) : null}
    </div>
  );
}
