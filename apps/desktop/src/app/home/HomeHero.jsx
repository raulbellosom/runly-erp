import { forwardRef } from "react";
import { History, Search, Star, WifiOff, X, LayoutGrid } from "lucide-react";
import { Input } from "@runly/ui";
import { HomeRecentChip } from "./HomeAppTiles";

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Buenos días";
  if (h < 19) return "Buenas tardes";
  return "Buenas noches";
}

function getSpanishDate() {
  try {
    const str = new Date().toLocaleDateString("es-MX", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    return str.charAt(0).toUpperCase() + str.slice(1);
  } catch {
    return new Date().toLocaleDateString();
  }
}

// Faint blueprint grid, faded towards the edges with a radial mask.
const GRID_STYLE = {
  backgroundImage:
    "linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)",
  backgroundSize: "36px 36px",
  maskImage: "radial-gradient(ellipse 80% 90% at 70% 0%, #000 30%, transparent 75%)",
  WebkitMaskImage: "radial-gradient(ellipse 80% 90% at 70% 0%, #000 30%, transparent 75%)",
};

function Stat({ icon: Icon, value, label }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/6 text-(--brand-primary)">
        <Icon size={16} />
      </span>
      <span className="leading-tight">
        <span className="block text-lg font-bold tabular-nums text-white">{value}</span>
        <span className="block text-[11px] uppercase tracking-wider text-white/50">{label}</span>
      </span>
    </div>
  );
}

export const HomeHero = forwardRef(function HomeHero(
  {
    firstName,
    appCount,
    favoriteCount,
    isOffline,
    query,
    onQueryChange,
    onQueryKeyDown,
    recentModules,
    onLaunch,
    isOfflineBlocked,
  },
  searchRef,
) {
  return (
    <section
      aria-label="Inicio"
      className="relative isolate overflow-hidden rounded-[28px] border border-white/10 text-white shadow-[0_30px_60px_-30px_rgba(12,23,45,0.55)]"
      style={{
        background:
          "linear-gradient(135deg, var(--runly-navy) 0%, var(--runly-navy-2) 60%, var(--runly-navy) 100%)",
      }}
    >
      <div aria-hidden className="absolute inset-0 -z-10" style={GRID_STYLE} />
      <div
        aria-hidden
        className="absolute -right-24 -top-32 -z-10 h-96 w-96 rounded-full opacity-40 blur-3xl"
        style={{ background: "radial-gradient(circle, var(--runly-cyan) 0%, transparent 65%)" }}
      />
      <div
        aria-hidden
        className="absolute -bottom-40 right-1/3 -z-10 h-80 w-80 rounded-full opacity-20 blur-3xl"
        style={{ background: "radial-gradient(circle, var(--runly-blue) 0%, transparent 65%)" }}
      />

      <div className="flex flex-col gap-6 p-6 md:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-(--brand-primary)">
              <span className="h-1.5 w-1.5 rounded-full bg-(--brand-primary)" />
              {getSpanishDate()}
            </p>
            <h1 className="text-3xl font-bold tracking-tight md:text-[2.6rem] md:leading-[1.1]">
              {getGreeting()}, <span className="text-white/70">{firstName}.</span>
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <Stat icon={LayoutGrid} value={appCount} label="Aplicaciones" />
            <Stat icon={Star} value={favoriteCount} label="Favoritas" />
            {isOffline && (
              <span className="flex items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1.5 text-xs font-medium text-amber-300">
                <WifiOff size={12} />
                Sin conexión al servidor
              </span>
            )}
          </div>
        </div>

        <div className="relative">
          <Search
            aria-hidden
            size={18}
            className="pointer-events-none absolute left-4 top-1/2 z-10 -translate-y-1/2 text-white/50"
          />
          <Input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={onQueryKeyDown}
            placeholder="Buscar una aplicación..."
            aria-label="Buscar una aplicación"
            autoComplete="off"
            className="h-12 rounded-2xl border-white/15! bg-white/7! pl-11 pr-20 text-base text-white shadow-none placeholder:text-white/45 focus-visible:border-transparent focus-visible:ring-(--brand-primary) sm:h-12 sm:text-[15px] [&::-webkit-search-cancel-button]:hidden"
          />
          {query ? (
            <button
              type="button"
              aria-label="Limpiar búsqueda"
              onClick={() => onQueryChange("")}
              className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-xl text-white/60 transition-colors hover:bg-white/10 hover:text-white"
            >
              <X size={16} />
            </button>
          ) : (
            <kbd className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 rounded-md border border-white/15 bg-white/6 px-2 py-0.5 font-mono text-xs text-white/55">
              /
            </kbd>
          )}
        </div>

        {recentModules.length > 0 && !query && (
          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
            <p className="flex shrink-0 items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-white/50">
              <History size={13} />
              Continuar
            </p>
            <div className="flex flex-wrap gap-2">
              {recentModules.map((module) => (
                <HomeRecentChip
                  key={module.key}
                  module={module}
                  onClick={() => onLaunch(module)}
                  isOfflineBlocked={isOfflineBlocked(module)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
});
