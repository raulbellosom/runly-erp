import * as LucideIcons from "lucide-react";
import { Card } from "./Card.jsx";
import { Skeleton } from "./Skeleton.jsx";

function GlyphIcon({ name, className, fallback = "FileText" }) {
  const Icon =
    (name && LucideIcons[name]) || LucideIcons[fallback] || LucideIcons.FileText;
  return <Icon className={className} aria-hidden="true" />;
}

// Presentational only. All props are fully resolved by the caller.
//   title       string
//   subtitle    string ("" hides it)
//   statusNode  ReactNode | null   (a pill/badge)
//   imageUrl    string | null
//   imageLoading bool
//   fallbackIcon string   (lucide icon name)
//   accentHex   string | null   (tints the fallback panel)
//   chips       [{ key, label, value, icon, type, colorHex }]
//   actions     ReactNode | null
//   onImageClick function | null — when set and there's an imageUrl, the
//               photo becomes a button (e.g. to open it in a viewer)
//   bare        bool — when true, renders just the inner content with no Card
//               wrapper, for callers (HeroContainer) that place this inside
//               their own outer card alongside a StatStrip (also `bare`), so
//               the two read as one continuous card instead of two stacked ones
export function DetailHero({
  title,
  subtitle,
  statusNode,
  imageUrl,
  imageLoading,
  fallbackIcon,
  accentHex,
  chips,
  actions,
  onImageClick,
  bare = false,
}) {
  const chipList = Array.isArray(chips) ? chips : [];
  const inner = (
      <div className="flex flex-col gap-4 sm:flex-row sm:gap-5">
        <div className="w-full shrink-0 sm:w-56">
          <div className="relative aspect-[16/9] overflow-hidden rounded-2xl border border-[hsl(var(--border))] sm:aspect-[4/3]">
            {imageLoading ? (
              <Skeleton className="h-full w-full" />
            ) : imageUrl ? (
              onImageClick ? (
                <button
                  type="button"
                  onClick={onImageClick}
                  className="block h-full w-full cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-inset"
                  aria-label="Ver imagen"
                >
                  <img
                    src={imageUrl}
                    alt={title ? `Imagen de ${title}` : "Imagen"}
                    className="h-full w-full object-cover"
                  />
                </button>
              ) : (
                <img
                  src={imageUrl}
                  alt={title ? `Imagen de ${title}` : "Imagen"}
                  className="h-full w-full object-cover"
                />
              )
            ) : (
              <div
                className="flex h-full w-full items-center justify-center bg-[hsl(var(--muted))]"
                style={
                  accentHex
                    ? {
                        backgroundImage: `radial-gradient(circle at 50% 38%, ${accentHex}33, transparent 70%)`,
                      }
                    : undefined
                }
              >
                <GlyphIcon
                  name={fallbackIcon}
                  className="h-14 w-14 text-[hsl(var(--muted-foreground))]"
                />
              </div>
            )}
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <h1 className="text-2xl font-bold tracking-tight text-[hsl(var(--foreground))]">
              {title || "—"}
            </h1>
            {statusNode}
          </div>

          {subtitle ? (
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              {subtitle}
            </p>
          ) : null}

          {chipList.length > 0 ? (
            <div className="mt-1 flex flex-wrap gap-2">
              {chipList.map((chip) => (
                <span
                  key={chip.key}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2.5 py-1 text-xs text-[hsl(var(--foreground))]"
                >
                  {chip.icon ? (
                    <GlyphIcon
                      name={chip.icon}
                      className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]"
                    />
                  ) : null}
                  {chip.label ? (
                    <span className="text-[hsl(var(--muted-foreground))]">
                      {chip.label}:
                    </span>
                  ) : null}
                  {chip.type === "color" && chip.colorHex ? (
                    <span
                      className="inline-block h-3 w-3 rounded-full border border-[hsl(var(--border))]"
                      style={{ backgroundColor: chip.colorHex }}
                    />
                  ) : null}
                  <span className="font-medium">{String(chip.value)}</span>
                </span>
              ))}
            </div>
          ) : null}

          {actions ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 sm:mt-auto sm:justify-end">
              {actions}
            </div>
          ) : null}
        </div>
      </div>
  );

  if (bare) return <div className="p-4 sm:p-5">{inner}</div>;
  return (
    <Card variant="shell" className="overflow-hidden p-4 sm:p-5">
      {inner}
    </Card>
  );
}
