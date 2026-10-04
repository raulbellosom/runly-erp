import { forwardRef } from "react";
import { History, Search, WifiOff, X } from "lucide-react";
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

// Light Home header: greeting + compact app search + "Continuar" recents.
// `actions` renders next to the search (e.g. the widget customizer).
export const HomeHeader = forwardRef(function HomeHeader(
  {
    firstName,
    isOffline,
    query,
    onQueryChange,
    onQueryKeyDown,
    recentModules,
    onLaunch,
    isOfflineBlocked,
    actions,
  },
  searchRef,
) {
  return (
    <header className="relative isolate space-y-5">
      {/* Soft brand glow, low contrast in both themes */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-10 -top-24 -z-10 h-64 w-[28rem] rounded-full opacity-[0.12] blur-3xl dark:opacity-[0.10]"
        style={{ background: "radial-gradient(circle, var(--brand-primary) 0%, transparent 70%)" }}
      />
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">
            <span className="h-1.5 w-1.5 rounded-full bg-(--brand-primary)" />
            {getSpanishDate()}
            {isOffline && (
              <span className="ml-2 flex items-center gap-1 normal-case tracking-normal text-amber-600 dark:text-amber-400">
                <WifiOff size={12} aria-hidden />
                Sin conexión al servidor
              </span>
            )}
          </p>
          <h1 className="text-3xl font-bold tracking-tight text-[hsl(var(--foreground))] md:text-4xl">
            {getGreeting()}, <span className="text-[hsl(var(--muted-foreground))]">{firstName}.</span>
          </h1>
        </div>

        <div className="flex w-full items-center gap-2 lg:w-auto">
          <div className="relative min-w-0 flex-1 lg:w-80 lg:flex-none">
            <Search
              aria-hidden
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-[hsl(var(--muted-foreground))]"
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
              className="h-9 rounded-xl bg-(--glass-bg) pl-9 pr-10 [&::-webkit-search-cancel-button]:hidden"
            />
            {query ? (
              <button
                type="button"
                aria-label="Limpiar búsqueda"
                onClick={() => onQueryChange("")}
                className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
              >
                <X size={14} />
              </button>
            ) : (
              <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-[hsl(var(--border))] px-1.5 font-mono text-[11px] text-[hsl(var(--muted-foreground))]">
                /
              </kbd>
            )}
          </div>
          {actions}
        </div>
      </div>

      {recentModules.length > 0 && !query && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <p className="flex shrink-0 items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
            <History size={13} aria-hidden />
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
    </header>
  );
});
