import { ArrowUpRight, WifiOff } from "lucide-react";
import { cn } from "@runly/ui";
import {
  CardShell,
  FavoriteStarButton,
  ModuleIcon,
  resolveModuleVisuals,
  toAlphaHexColor,
  useCardLongPress,
} from "../../components/ModuleCard";

// Star is revealed on hover/focus for non-favorites; always shown when the app
// is a favorite and always shown on touch devices (no hover there).
const STAR_REVEAL =
  "opacity-0 group-hover/tile:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100";

function TileOverlay({ module, isFavorite, isOfflineBlocked, onToggleFavorite, className }) {
  if (isOfflineBlocked) {
    return (
      <WifiOff
        size={13}
        aria-label="No disponible sin conexión"
        className={cn("absolute text-[hsl(var(--muted-foreground))]", className)}
      />
    );
  }
  return (
    <FavoriteStarButton
      moduleKey={module.key}
      isFavorite={isFavorite}
      onToggleFavorite={onToggleFavorite}
      className={cn("absolute z-20", !isFavorite && STAR_REVEAL, className)}
    />
  );
}

function tileClassName(isOfflineBlocked, extra) {
  return cn(
    "relative isolate flex w-full overflow-hidden text-left border",
    "border-[hsl(var(--border))] bg-[hsl(var(--card))]",
    "transition-[transform,box-shadow,border-color] duration-200 ease-out",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]",
    isOfflineBlocked
      ? "opacity-45 cursor-not-allowed pointer-events-none"
      : "cursor-pointer hover:border-(--tile-edge) hover:shadow-[0_10px_30px_-12px_var(--tile-glow)] active:scale-[0.985]",
    extra,
  );
}

function tileStyle(color) {
  return {
    "--tile-edge": toAlphaHexColor(color, "66"),
    "--tile-glow": toAlphaHexColor(color, "55"),
  };
}

// ---- Compact tile: dense row-shaped card for the full app grid ----
export function HomeAppTile({
  module,
  onClick,
  onContextMenu,
  onLongPress,
  onToggleFavorite,
  isFavorite,
  isOfflineBlocked,
  highlighted = false,
}) {
  const { color, accentColor } = resolveModuleVisuals(module);
  const { longPressHandlers, guardClick } = useCardLongPress(module.key, onLongPress);

  return (
    <CardShell
      wrapperClassName="group/tile"
      cardClassName={tileClassName(
        isOfflineBlocked,
        cn(
          "h-17 items-center gap-3 rounded-xl pl-3 pr-11",
          highlighted && "ring-2 ring-(--brand-primary) border-transparent",
        ),
      )}
      longPressHandlers={longPressHandlers}
      guardClick={guardClick}
      onClick={onClick}
      onContextMenu={onContextMenu}
      isOfflineBlocked={isOfflineBlocked}
      overlay={
        <TileOverlay
          module={module}
          isFavorite={isFavorite}
          isOfflineBlocked={isOfflineBlocked}
          onToggleFavorite={onToggleFavorite}
          className="right-2 top-1/2 -translate-y-1/2"
        />
      }
    >
      {/* Module-tinted wash that sweeps in from the icon side on hover */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 -z-10 w-2/3 opacity-0 transition-opacity duration-300 group-hover/tile:opacity-100"
        style={{
          background: `linear-gradient(90deg, ${toAlphaHexColor(color, "1f")} 0%, ${toAlphaHexColor(accentColor, "00")} 100%)`,
        }}
      />
      <ModuleIcon module={module} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold leading-tight text-[hsl(var(--foreground))]">
          {module.name}
        </span>
        <span className="mt-0.5 block truncate text-xs text-[hsl(var(--muted-foreground))]">
          {module.summary || module.description}
        </span>
      </span>
    </CardShell>
  );
}

// ---- Featured tile: larger card for favorites, with an icon watermark ----
export function HomeFeaturedTile({
  module,
  onClick,
  onContextMenu,
  onLongPress,
  onToggleFavorite,
  isFavorite,
  isOfflineBlocked,
  highlighted = false,
}) {
  const { color, accentColor, iconComponent: Icon } = resolveModuleVisuals(module);
  const { longPressHandlers, guardClick } = useCardLongPress(module.key, onLongPress);

  return (
    <CardShell
      wrapperClassName="group/tile"
      cardClassName={tileClassName(
        isOfflineBlocked,
        cn(
          "h-36 flex-col justify-between rounded-2xl p-4",
          highlighted && "ring-2 ring-(--brand-primary) border-transparent",
        ),
      )}
      longPressHandlers={longPressHandlers}
      guardClick={guardClick}
      onClick={onClick}
      onContextMenu={onContextMenu}
      isOfflineBlocked={isOfflineBlocked}
      overlay={
        <TileOverlay
          module={module}
          isFavorite={isFavorite}
          isOfflineBlocked={isOfflineBlocked}
          onToggleFavorite={onToggleFavorite}
          className="right-2 top-2"
        />
      }
    >
      <span
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-12 -z-10 h-40 w-40 rounded-full blur-2xl opacity-70 transition-transform duration-500 ease-out group-hover/tile:scale-125"
        style={{
          background: `radial-gradient(circle, ${toAlphaHexColor(color, "40")} 0%, ${toAlphaHexColor(accentColor, "00")} 70%)`,
        }}
      />
      {Icon && (
        <Icon
          aria-hidden
          strokeWidth={1.25}
          className="pointer-events-none absolute -bottom-5 -right-3 -z-10 h-28 w-28 -rotate-12 opacity-[0.07] transition-transform duration-500 ease-out group-hover/tile:-rotate-6"
          style={{ color }}
        />
      )}
      <ModuleIcon module={module} size="md" />
      <span className="min-w-0">
        <span className="flex items-center gap-1 text-[15px] font-semibold leading-tight text-[hsl(var(--foreground))]">
          <span className="truncate">{module.name}</span>
          <ArrowUpRight
            aria-hidden
            size={15}
            className="shrink-0 -translate-x-1 opacity-0 transition-all duration-200 group-hover/tile:translate-x-0 group-hover/tile:opacity-60"
          />
        </span>
        <span className="mt-1 line-clamp-2 min-h-[2.1rem] text-xs leading-snug text-[hsl(var(--muted-foreground))]">
          {module.summary || module.description}
        </span>
      </span>
    </CardShell>
  );
}

// ---- Recent chip: pill shown in the header "Continuar" row ----
export function HomeRecentChip({ module, onClick, isOfflineBlocked }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isOfflineBlocked}
      title={module.name}
      className={cn(
        "flex min-h-10 max-w-56 items-center gap-1.5 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card))] py-1 pl-1 pr-3.5 text-left text-sm font-medium text-[hsl(var(--foreground))]",
        "transition-colors duration-200 hover:border-[hsl(var(--muted-foreground))]/40 hover:bg-[hsl(var(--muted))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]",
        "disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer",
      )}
    >
      <span className="scale-[0.8]">
        <ModuleIcon module={module} size="sm" />
      </span>
      <span className="truncate">{module.name}</span>
    </button>
  );
}
