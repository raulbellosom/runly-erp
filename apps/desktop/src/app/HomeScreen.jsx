import { useEffect, useMemo, useRef, useState } from "react";
import { LayoutGrid, SearchX } from "lucide-react";
import { Skeleton, EmptyState, Button } from "@runly/ui";
import { useAuth } from "../auth/AuthProvider";
import { useRuntimeModules } from "./useRuntimeModules";
import { useModuleLauncher } from "../hooks/useModuleLauncher";
import { AppViewControls } from "../components/AppViewControls";
import { AppContextMenu } from "../components/AppContextMenu";
import { ModuleListRow } from "../components/ModuleCard";
import { filterModulesByQuery, readRecentModuleKeys } from "../lib/recentModules";
import { availableWidgets } from "../lib/homeWidgets";
import { useHomeWidgetPrefs } from "../hooks/useHomeWidgetPrefs";
import { HomeHeader } from "./home/HomeHeader";
import { HomeAppTile, HomeFeaturedTile } from "./home/HomeAppTiles";
import { HomeWidgetBoard, HomeWidgetCustomizer } from "./home/HomeWidgetBoard";
import { HOME_WIDGETS } from "./home/widgets/registry";

const RECENT_LIMIT = 6;
const COMPACT_GRID = "grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4";
const FEATURED_GRID = "grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5";

function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

function SectionHeader({ label, count, children }) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-3">
      <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))]">
        {label}
        <span className="rounded-full bg-[hsl(var(--muted))] px-2 py-0.5 text-[11px] font-semibold tabular-nums tracking-normal text-[hsl(var(--foreground))]">
          {count}
        </span>
      </h2>
      <span aria-hidden className="h-px min-w-8 flex-1 bg-[hsl(var(--border))]" />
      {children}
    </div>
  );
}

export function HomeScreen() {
  const { userProfile } = useAuth();
  const {
    availableModules,
    isLoading: modulesLoading,
    isError: modulesFailed,
    error: modulesErrorDetail,
  } = useRuntimeModules();
  // Only a request that never reached the API (no HTTP status) means "offline";
  // 401/409/5xx answers come from a server that is up.
  const modulesError = modulesFailed && !modulesErrorDetail?.status;
  const {
    sections,
    viewMode,
    isOfflineBlocked,
    contextMenu,
    openMenu,
    closeMenu,
    isFavorite,
    toggleFavorite,
    launch,
  } = useModuleLauncher(availableModules);

  const [query, setQuery] = useState("");
  const [recentKeys] = useState(readRecentModuleKeys);
  const searchRef = useRef(null);

  const firstName = userProfile?.firstName ?? userProfile?.displayName ?? "tú";


  const results = useMemo(
    () => (query.trim() ? filterModulesByQuery(availableModules, query) : null),
    [availableModules, query],
  );

  const widgetPrefs = useHomeWidgetPrefs();
  const modulesByKey = useMemo(
    () => new Map(availableModules.map((m) => [m.key, m])),
    [availableModules],
  );
  const offeredWidgets = useMemo(
    () => availableWidgets(HOME_WIDGETS, modulesByKey.keys()),
    [modulesByKey],
  );
  const shownWidgets = offeredWidgets.filter((w) => !widgetPrefs.hidden.includes(w.id));
  const recentModules = useMemo(
    () => recentKeys.map((k) => modulesByKey.get(k)).filter(Boolean).slice(0, RECENT_LIMIT),
    [modulesByKey, recentKeys],
  );

  // "/" focuses the app search from anywhere on Home (unless already typing).
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingTarget(document.activeElement)) return;
      e.preventDefault();
      searchRef.current?.focus();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function handleQueryKeyDown(e) {
    if (e.key === "Escape") {
      setQuery("");
    } else if (e.key === "Enter" && results?.length) {
      e.preventDefault();
      launch(results[0]);
    }
  }

  function tileProps(module) {
    return {
      module,
      onClick: () => launch(module),
      onContextMenu: (e) => openMenu(e, module.key),
      onLongPress: openMenu,
      onToggleFavorite: toggleFavorite,
      isFavorite: isFavorite(module.key),
      isOfflineBlocked: isOfflineBlocked(module),
    };
  }

  function renderModules(modules, { featured = false } = {}) {
    if (viewMode === "list") {
      return (
        <div className="grid gap-2 lg:grid-cols-2">
          {modules.map((m) => (
            <ModuleListRow key={m.key} {...tileProps(m)} />
          ))}
        </div>
      );
    }
    const Tile = featured ? HomeFeaturedTile : HomeAppTile;
    return (
      <div className={featured ? FEATURED_GRID : COMPACT_GRID}>
        {modules.map((m) => (
          <Tile key={m.key} {...tileProps(m)} />
        ))}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-10 px-4 py-6 md:px-8 md:py-8">
      <HomeHeader
        ref={searchRef}
        firstName={firstName}
        isOffline={modulesError}
        query={query}
        onQueryChange={setQuery}
        onQueryKeyDown={handleQueryKeyDown}
        recentModules={recentModules}
        onLaunch={launch}
        isOfflineBlocked={isOfflineBlocked}
        actions={
          <HomeWidgetCustomizer
            widgets={offeredWidgets}
            hidden={widgetPrefs.hidden}
            onToggle={widgetPrefs.toggle}
          />
        }
      />

      {!query && !modulesLoading && !widgetPrefs.isLoading && (
        <HomeWidgetBoard widgets={shownWidgets} modulesByKey={modulesByKey} />
      )}

      {modulesLoading ? (
        <div className="space-y-8">
          <div className={FEATURED_GRID}>
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-36 w-full rounded-2xl" />
            ))}
          </div>
          <div className={COMPACT_GRID}>
            {Array.from({ length: 9 }).map((_, i) => (
              <Skeleton key={i} className="h-17 w-full rounded-xl" />
            ))}
          </div>
        </div>
      ) : results ? (
        <section aria-live="polite">
          <SectionHeader label="Resultados" count={results.length}>
            {results.length > 0 && (
              <span className="text-xs text-[hsl(var(--muted-foreground))]">
                Enter abre la primera
              </span>
            )}
          </SectionHeader>
          {results.length > 0 ? (
            <div className={COMPACT_GRID}>
              {results.map((m, i) => (
                <HomeAppTile key={m.key} {...tileProps(m)} highlighted={i === 0} />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={SearchX}
              title={`Sin resultados para «${query.trim()}»`}
              description="Prueba con otro nombre o revisa las aplicaciones instaladas."
              action={
                <Button variant="outline" size="sm" onClick={() => setQuery("")}>
                  Limpiar búsqueda
                </Button>
              }
            />
          )}
        </section>
      ) : availableModules.length === 0 ? (
        <EmptyState
          icon={LayoutGrid}
          title="No hay aplicaciones disponibles"
          description="Cuando se instalen o habiliten módulos aparecerán aquí."
        />
      ) : (
        <div className="space-y-9">
          {sections.map((section, si) => {
            const isFavorites = section.kind === "favorites";
            return (
              <section key={section.label ?? `section-${si}`}>
                <SectionHeader
                  label={section.label ?? "Todas las aplicaciones"}
                  count={section.modules.length}
                >
                  {si === 0 && <AppViewControls />}
                </SectionHeader>
                {renderModules(section.modules, { featured: isFavorites })}
              </section>
            );
          })}
        </div>
      )}

      {contextMenu && (
        <AppContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          moduleKey={contextMenu.moduleKey}
          onClose={closeMenu}
        />
      )}
    </div>
  );
}
