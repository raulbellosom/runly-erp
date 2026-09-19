import { Star, WifiOff } from "lucide-react";
import { useRef } from "react";
import { cn, getModuleIconComponent, useLongPress } from "@runly/ui";
import {
  favoriteToggleLabel,
  shouldOpenInNewTab,
  isCoarsePointer,
} from "../lib/moduleLauncher";

// ---- Constants ----
const DEFAULT_MODULE_COLOR = "#6366f1";
const DEFAULT_MODULE_ACCENT = "#4f46e5";

// Surface presets. "raised" is the default opaque card used on solid
// backgrounds (HomeScreen). "glass" is used inside translucent overlays
// (AppLauncher): translucent fill + soft glass border + softer hover so the
// card reads as part of the frosted panel instead of a solid block on it.
const CARD_SURFACE = {
  raised: {
    base: "border-[hsl(var(--border))] bg-[hsl(var(--card))]",
    hoverGrid: "hover:shadow-md hover:-translate-y-0.5 active:scale-[0.98]",
    hoverRow:
      "hover:shadow-sm hover:border-[hsl(var(--muted-foreground))]/30 active:scale-[0.99]",
    headerAlpha: ["22", "08"],
  },
  glass: {
    base: "border-(--glass-border) bg-(--glass-bg)",
    hoverGrid:
      "hover:bg-[hsl(var(--muted))] hover:border-[hsl(var(--muted-foreground))]/25 active:scale-[0.98]",
    hoverRow:
      "hover:bg-[hsl(var(--muted))] hover:border-[hsl(var(--muted-foreground))]/25 active:scale-[0.99]",
    headerAlpha: ["14", "04"],
  },
};

// ---- Helpers ----
function getGeneratedInitials(name) {
  if (typeof name !== "string" || !name.trim()) return "";
  const words = name
    .trim()
    .split(/\s+/)
    .map((w) => w[0]?.toUpperCase())
    .filter(Boolean);
  if (words.length >= 2) return `${words[0]}${words[1]}`;
  return words[0] ?? "";
}

export function toAlphaHexColor(color, alphaHex) {
  if (typeof color !== "string") return color;
  const trimmed = color.trim();
  if (!trimmed) return color;
  if (
    trimmed.startsWith("#") &&
    (trimmed.length === 4 || trimmed.length === 7)
  ) {
    return `${trimmed}${alphaHex}`;
  }
  return color;
}

export function resolveModuleVisuals(module) {
  const manifest = module?.manifest ?? {};
  const name = module?.name ?? module?.key ?? "Módulo";
  const color = module?.color ?? manifest?.color ?? DEFAULT_MODULE_COLOR;
  const accentColor =
    manifest?.accentColor ??
    module?.color ??
    manifest?.color ??
    DEFAULT_MODULE_ACCENT;
  const logoUrl = manifest?.logoUrl ?? module?.logoUrl ?? null;
  const requestedIcon = manifest?.icon ?? module?.icon ?? null;
  const iconComponent = getModuleIconComponent(requestedIcon);
  const generatedInitials = getGeneratedInitials(name);
  const fallbackInitial = name.trim().charAt(0).toUpperCase();
  const initials =
    manifest?.initials ?? generatedInitials ?? fallbackInitial ?? "M";

  return { color, accentColor, logoUrl, iconComponent, initials };
}

// ---- ModuleIcon: gradient icon with initials / logo / lucide icon ----
export function ModuleIcon({ module, size = "md" }) {
  const visuals = resolveModuleVisuals(module);
  const {
    color,
    accentColor,
    logoUrl,
    iconComponent: IconComponent,
    initials,
  } = visuals;

  const cls =
    {
      sm: "h-8 w-8 rounded-lg text-sm",
      md: "h-11 w-11 rounded-xl text-base",
      lg: "h-14 w-14 rounded-2xl text-2xl",
    }[size] ?? "h-11 w-11 rounded-xl text-base";

  return (
    <div
      className={cn(
        "flex items-center justify-center font-black text-white select-none shrink-0",
        cls,
      )}
      style={{
        background: `linear-gradient(135deg, ${color} 0%, ${accentColor} 100%)`,
      }}
    >
      {logoUrl ? (
        <img
          src={logoUrl}
          alt={module.name}
          className="h-full w-full object-contain rounded-[inherit]"
          draggable={false}
        />
      ) : IconComponent ? (
        <IconComponent className="h-1/2 w-1/2" />
      ) : (
        <span>{initials}</span>
      )}
    </div>
  );
}

// ---- FavoriteStarButton: always-visible star toggle used on cards/rows ----
function FavoriteStarButton({ moduleKey, isFavorite, onToggleFavorite, className }) {
  return (
    <button
      type="button"
      aria-pressed={isFavorite}
      aria-label={favoriteToggleLabel(isFavorite)}
      title={favoriteToggleLabel(isFavorite)}
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggleFavorite(moduleKey);
      }}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--muted))] hover:text-amber-400 cursor-pointer",
        className,
      )}
    >
      <Star
        size={14}
        className={isFavorite ? "text-amber-400 fill-amber-400" : ""}
      />
    </button>
  );
}

// Wires long-press -> onLongPress({x,y}, key) on coarse pointers only, and
// returns a `guardClick` that swallows the post-long-press click so it does
// not also navigate.
function useCardLongPress(moduleKey, onLongPress) {
  const suppressClick = useRef(false);
  const handlers = useLongPress({
    disabled: !onLongPress || !isCoarsePointer(),
    ignoreInteractiveTarget: true,
    onLongPress: (e) => {
      suppressClick.current = true;
      onLongPress?.({ x: e.clientX, y: e.clientY }, moduleKey);
    },
  });
  const longPressHandlers = {
    ...handlers,
    onPointerDown: (e) => {
      suppressClick.current = false;
      handlers.onPointerDown?.(e);
    },
  };
  const guardClick = (e, run) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      e.preventDefault();
      return;
    }
    run();
  };
  return { longPressHandlers, guardClick };
}

// ---- CardShell: card <a>/<button> + a sibling overlay, never nested buttons ----
// The favorite toggle is its own <button>; nesting it inside the card's
// <button>/<a> is invalid HTML, so it is rendered as an absolutely-positioned
// sibling within a `relative` wrapper.
function CardShell({
  href,
  cardClassName,
  wrapperClassName,
  longPressHandlers,
  guardClick,
  onClick,
  onContextMenu,
  isOfflineBlocked,
  overlay,
  children,
}) {
  const card = href ? (
    <a
      href={href}
      onContextMenu={onContextMenu}
      {...longPressHandlers}
      onClick={(e) => {
        if (shouldOpenInNewTab(e)) return;
        e.preventDefault();
        guardClick(e, () => onClick?.());
      }}
      aria-disabled={isOfflineBlocked || undefined}
      className={cardClassName}
    >
      {children}
    </a>
  ) : (
    <button
      onContextMenu={onContextMenu}
      {...longPressHandlers}
      onClick={(e) => guardClick(e, () => onClick?.())}
      disabled={isOfflineBlocked}
      className={cardClassName}
    >
      {children}
    </button>
  );

  return (
    <div className={cn("relative", wrapperClassName)}>
      {card}
      {overlay}
    </div>
  );
}

// ---- ModuleCardGrid: grid card for navigation (HomeScreen, AppLauncher) ----
export function ModuleCardGrid({
  module,
  onClick,
  onContextMenu,
  onToggleFavorite,
  onLongPress,
  href,
  isFavorite,
  isOfflineBlocked,
  surface = "raised",
}) {
  const visuals = resolveModuleVisuals(module);
  const { color, accentColor } = visuals;
  const { longPressHandlers, guardClick } = useCardLongPress(module.key, onLongPress);
  const skin = CARD_SURFACE[surface] ?? CARD_SURFACE.raised;

  const cardClassName = cn(
    "group flex w-full flex-col rounded-2xl border overflow-hidden text-left transition-all duration-200",
    skin.base,
    isOfflineBlocked
      ? "opacity-40 cursor-not-allowed pointer-events-none"
      : cn("cursor-pointer", skin.hoverGrid),
  );

  const overlay = isOfflineBlocked ? (
    <WifiOff
      size={11}
      className="absolute top-3 right-3 text-[hsl(var(--muted-foreground))]"
    />
  ) : (
    <FavoriteStarButton
      moduleKey={module.key}
      isFavorite={isFavorite}
      onToggleFavorite={onToggleFavorite}
      className="absolute top-1.5 right-1.5 z-20"
    />
  );

  return (
    <CardShell
      href={href}
      cardClassName={cardClassName}
      longPressHandlers={longPressHandlers}
      guardClick={guardClick}
      onClick={onClick}
      onContextMenu={onContextMenu}
      isOfflineBlocked={isOfflineBlocked}
      overlay={overlay}
    >
      {/* Gradient header */}
      <div
        className="relative h-16 overflow-hidden shrink-0"
        style={{
          background: `linear-gradient(135deg, ${toAlphaHexColor(color, skin.headerAlpha[0])} 0%, ${toAlphaHexColor(accentColor, skin.headerAlpha[1])} 70%, transparent 100%)`,
        }}
      >
        <div
          className="absolute -right-6 -top-6 h-20 w-20 rounded-full opacity-[0.12]"
          style={{ background: accentColor }}
        />
        <div
          className="absolute right-8 top-2 h-8 w-8 rounded-full opacity-[0.08]"
          style={{ background: color }}
        />
      </div>

      {/* Icon overlapping header/body boundary */}
      <div className="px-4 -mt-5 relative z-10 shrink-0">
        <ModuleIcon module={module} size="sm" />
      </div>

      {/* Body */}
      <div className="px-4 pb-4 pt-2 flex flex-col gap-1 flex-1">
        <p className="text-sm font-semibold text-[hsl(var(--foreground))] leading-tight truncate">
          {module.name}
        </p>
        <p className="text-xs text-[hsl(var(--muted-foreground))] line-clamp-2 leading-snug min-h-[2.1rem]">
          {module.summary || module.description}
        </p>
      </div>
    </CardShell>
  );
}

// ---- ModuleListRow: list row for navigation (HomeScreen, AppLauncher) ----
export function ModuleListRow({
  module,
  onClick,
  onContextMenu,
  onToggleFavorite,
  onLongPress,
  href,
  isFavorite,
  isOfflineBlocked,
  surface = "raised",
}) {
  const { longPressHandlers, guardClick } = useCardLongPress(module.key, onLongPress);
  const skin = CARD_SURFACE[surface] ?? CARD_SURFACE.raised;

  const cardClassName = cn(
    "flex items-center gap-4 w-full rounded-xl border transition-all duration-200 py-3 pl-4 pr-12 text-left",
    skin.base,
    isOfflineBlocked
      ? "opacity-40 cursor-not-allowed pointer-events-none"
      : cn("cursor-pointer", skin.hoverRow),
  );

  const overlay = isOfflineBlocked ? (
    <WifiOff
      size={13}
      className="absolute right-4 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]"
    />
  ) : (
    <FavoriteStarButton
      moduleKey={module.key}
      isFavorite={isFavorite}
      onToggleFavorite={onToggleFavorite}
      className="absolute right-2 top-1/2 z-20 -translate-y-1/2"
    />
  );

  return (
    <CardShell
      href={href}
      cardClassName={cardClassName}
      longPressHandlers={longPressHandlers}
      guardClick={guardClick}
      onClick={onClick}
      onContextMenu={onContextMenu}
      isOfflineBlocked={isOfflineBlocked}
      overlay={overlay}
    >
      <ModuleIcon module={module} size="sm" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-[hsl(var(--foreground))] leading-tight">
          {module.name}
        </p>
        <p className="text-xs text-[hsl(var(--muted-foreground))] truncate">
          {module.summary || module.description}
        </p>
      </div>
    </CardShell>
  );
}
