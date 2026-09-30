import { useRef, useCallback } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ArrowUpDown, ChevronDown, EyeOff, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../components/DropdownMenu.jsx";
import { cn } from "../lib/utils.js";

const LONGPRESS_MS = 300;

// Column header: for a sortable column, clicking the label cycles
// ascendente -> descendente -> sin orden; the chevron opens the column menu
// (sort, move, hide). Long-press opens the menu on touch.
export function ColumnHeaderMenu({
  column,
  canMoveLeft,
  canMoveRight,
  onHide,
  onMoveLeft,
  onMoveRight,
  sortDir = null,
  onSort = null,
  children,
}) {
  const timerRef = useRef(null);
  const openRef = useRef(null);
  const sortable = Boolean(column.sortable && onSort);

  const startLongPress = useCallback(() => {
    timerRef.current = setTimeout(() => {
      openRef.current?.click();
    }, LONGPRESS_MS);
  }, []);

  const cancelLongPress = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const cycleSort = () => {
    if (!sortDir) onSort(column.field, "asc");
    else if (sortDir === "asc") onSort(column.field, "desc");
    else onSort("", "asc");
  };

  const SortIcon = sortDir === "asc" ? ArrowUp : sortDir === "desc" ? ArrowDown : ArrowUpDown;

  return (
    <DropdownMenu>
      <div
        className="group flex w-full items-center gap-1"
        onTouchStart={startLongPress}
        onTouchEnd={cancelLongPress}
        onTouchCancel={cancelLongPress}
      >
        {sortable ? (
          <button
            type="button"
            onClick={cycleSort}
            className={cn(
              "inline-flex min-w-0 items-center gap-1 text-left focus:outline-none focus-visible:underline",
              sortDir && "text-[hsl(var(--foreground))]",
            )}
            title="Ordenar"
          >
            <span className="truncate">{children}</span>
            <SortIcon
              className={cn(
                "h-3.5 w-3.5 shrink-0 transition-opacity",
                sortDir ? "opacity-90" : "opacity-0 group-hover:opacity-50",
              )}
            />
          </button>
        ) : (
          <span className="truncate">{children}</span>
        )}
        <DropdownMenuTrigger asChild>
          <button
            ref={openRef}
            type="button"
            aria-label={`Opciones de columna ${typeof children === "string" ? children : ""}`.trim()}
            className="ml-auto inline-flex h-5 w-5 shrink-0 items-center justify-center rounded opacity-0 transition-opacity hover:bg-[hsl(var(--muted))] focus:opacity-60 group-hover:opacity-60 data-[state=open]:opacity-80"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </DropdownMenuTrigger>
      </div>

      <DropdownMenuContent align="start" className="min-w-45">
        {sortable && (
          <>
            <DropdownMenuItem onClick={() => onSort(column.field, "asc")}>
              <ArrowUp className="mr-2 h-3.5 w-3.5" />
              Orden ascendente
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onSort(column.field, "desc")}>
              <ArrowDown className="mr-2 h-3.5 w-3.5" />
              Orden descendente
            </DropdownMenuItem>
            {sortDir && (
              <DropdownMenuItem onClick={() => onSort("", "asc")}>
                <X className="mr-2 h-3.5 w-3.5" />
                Quitar orden
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
          </>
        )}
        {canMoveLeft && (
          <DropdownMenuItem onClick={() => onMoveLeft(column.key)}>
            <ArrowLeft className="mr-2 h-3.5 w-3.5" />
            Mover a la izquierda
          </DropdownMenuItem>
        )}
        {canMoveRight && (
          <DropdownMenuItem onClick={() => onMoveRight(column.key)}>
            <ArrowRight className="mr-2 h-3.5 w-3.5" />
            Mover a la derecha
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onClick={() => onHide(column.key)}
          className="text-[hsl(var(--muted-foreground))]"
        >
          <EyeOff className="mr-2 h-3.5 w-3.5" />
          Ocultar columna
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
