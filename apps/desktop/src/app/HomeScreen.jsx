import { WifiOff } from "lucide-react";
import { Skeleton, Separator } from "@runly/ui";
import { useAuth } from "../auth/AuthProvider";
import { useRuntimeModules } from "./useRuntimeModules";
import { useModuleLauncher } from "../hooks/useModuleLauncher";
import { AppViewControls } from "../components/AppViewControls";
import { AppContextMenu } from "../components/AppContextMenu";
import { ModuleCardGrid, ModuleListRow } from "../components/ModuleCard";

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

  const firstName = userProfile?.firstName ?? userProfile?.displayName ?? "tú";

  return (
    <div className="max-w-5xl mx-auto px-4 py-10 md:px-6 space-y-10">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mb-1">
            {getSpanishDate()}
          </p>
          <h1 className="text-3xl font-bold tracking-tight text-[hsl(var(--foreground))]">
            {getGreeting()}, {firstName}.
          </h1>
        </div>
        {modulesError && (
          <div className="flex items-center gap-1.5 text-xs text-amber-500 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 mt-1 shrink-0">
            <WifiOff size={11} />
            Sin conexión al servidor
          </div>
        )}
      </div>

      {/* Aplicaciones */}
      <div className="space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-base font-semibold text-[hsl(var(--foreground))] shrink-0">
            Aplicaciones
          </h2>
          <Separator className="flex-1 min-w-8" />
          <AppViewControls />
        </div>

        <div className="space-y-8">
          {modulesLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-32 w-full rounded-2xl" />
              ))}
            </div>
          ) : (
            sections.map((section, si) => (
              <div key={section.label ?? `section-${si}`}>
                {section.label && (
                  <p className="text-xs font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))] mb-3">
                    {section.label}
                  </p>
                )}
                {viewMode === "list" ? (
                  <div className="flex flex-col gap-1.5">
                    {section.modules.map((module) => (
                      <ModuleListRow
                        key={module.key}
                        module={module}
                        onClick={() => launch(module)}
                        onContextMenu={(e) => openMenu(e, module.key)}
                        onLongPress={openMenu}
                        onToggleFavorite={toggleFavorite}
                        isFavorite={isFavorite(module.key)}
                        isOfflineBlocked={isOfflineBlocked(module)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                    {section.modules.map((module) => (
                      <ModuleCardGrid
                        key={module.key}
                        module={module}
                        onClick={() => launch(module)}
                        onContextMenu={(e) => openMenu(e, module.key)}
                        onLongPress={openMenu}
                        onToggleFavorite={toggleFavorite}
                        isFavorite={isFavorite(module.key)}
                        isOfflineBlocked={isOfflineBlocked(module)}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))
          )}

          {!modulesLoading && availableModules.length === 0 && (
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              No hay aplicaciones disponibles.
            </p>
          )}
        </div>
      </div>

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
