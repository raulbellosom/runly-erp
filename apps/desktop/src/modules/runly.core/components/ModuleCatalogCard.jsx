// apps/desktop/src/modules/runly.core/components/ModuleCatalogCard.jsx
//
// Status pill + primary inline card action for the module catalog screen,
// plus its filter/tab lookup tables. Extracted from ModuleCatalog.jsx on
// 2026-09-25 to keep that file under the CLAUDE.md 1000-line limit.
import { Button, cn } from "@runly/ui";
import { Power, RefreshCw, ArrowUpRight } from "lucide-react";
import { isModuleAvailable } from "../../../lib/runtimeModules";
import { STATUS_DOT, statusLabel, isLocked } from "../lib/moduleCatalogHelpers";

export const TYPE_FILTERS = [
  {
    key: "type",
    label: "Tipo",
    options: [
      { value: "core", label: "Core" },
      { value: "feature", label: "Módulo" },
    ],
  },
  {
    key: "compat",
    label: "Compatibilidad",
    options: [
      { value: "ok", label: "Compatible" },
      { value: "blocked", label: "Bloqueado" },
    ],
  },
];

export const STATUS_TABS = [
  { value: "all", label: "Todos" },
  { value: "INSTALLED", label: "Instalados" },
  { value: "DISABLED", label: "Deshabilitados" },
  { value: "UNINSTALLED", label: "Sin instalar" },
];

// ---- Status pill ----
export function StatusPill({ module, className }) {
  const isInstalled =
    module.status === "INSTALLED" && module.enabled && !module.updateAvailable;
  const dotColor = module.updateAvailable
    ? "#0ea5e9"
    : (STATUS_DOT[module.status] ?? "#94a3b8");
  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <span
        className={cn(
          "h-2 w-2 rounded-full shrink-0",
          isInstalled && "shadow-[0_0_6px_rgba(34,197,94,0.7)]",
          module.updateAvailable && "shadow-[0_0_6px_rgba(14,165,233,0.7)]",
        )}
        style={{ backgroundColor: dotColor }}
      />
      <span className="text-[11px] font-medium text-[hsl(var(--muted-foreground))]">
        {statusLabel(module)}
      </span>
    </div>
  );
}

// ---- Card primary action (inline on card) ----
export function CardAction({
  module,
  canInstallModules,
  canDisableModules,
  onAction,
  onOpen,
  onViewError,
}) {
  const canOpen = isModuleAvailable(module);
  const canSyncModule = canOpen && module.updateAvailable && canInstallModules;
  const canInstall =
    module.status === "UNINSTALLED" &&
    canInstallModules &&
    module.compatibilityStatus !== "BLOCKED";
  const canEnable =
    module.status === "DISABLED" && !isLocked(module) && canDisableModules;
  const canRetryInstall =
    module.status === "ERROR" && !isLocked(module) && canInstallModules;

  if (canSyncModule) {
    return (
      <Button
        size="sm"
        className="shrink-0 h-7 px-2.5 text-xs gap-1 bg-sky-600 text-white hover:bg-sky-700 dark:bg-sky-500 dark:hover:bg-sky-400"
        onClick={(e) => {
          e.stopPropagation();
          onAction("sync-module", module);
        }}
      >
        Sincronizar
        <RefreshCw className="h-3 w-3" />
      </Button>
    );
  }
  if (canOpen) {
    return (
      <Button
        size="sm"
        className="shrink-0 h-7 px-2.5 text-xs gap-1 bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-400"
        onClick={(e) => {
          e.stopPropagation();
          onOpen(module);
        }}
      >
        Abrir
        <ArrowUpRight className="h-3 w-3" />
      </Button>
    );
  }
  if (canEnable) {
    return (
      <Button
        size="sm"
        className="shrink-0 h-7 px-2.5 text-xs gap-1"
        onClick={(e) => {
          e.stopPropagation();
          onAction("enable", module);
        }}
      >
        Activar
        <Power className="h-3 w-3" />
      </Button>
    );
  }
  if (canInstall) {
    return (
      <Button
        size="sm"
        className="shrink-0 h-7 px-2.5 text-xs gap-1 bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-400"
        onClick={(e) => {
          e.stopPropagation();
          onAction("install", module);
        }}
      >
        Instalar
      </Button>
    );
  }
  if (canRetryInstall) {
    return (
      <div className="flex items-center gap-1.5 shrink-0">
        <Button
          size="sm"
          className="shrink-0 h-7 px-2.5 text-xs gap-1 bg-amber-400 text-amber-950 hover:bg-amber-500 dark:bg-amber-300 dark:hover:bg-amber-200"
          onClick={(e) => {
            e.stopPropagation();
            onAction("retry-install", module);
          }}
        >
          Reintentar
        </Button>
        {onViewError && (
          <Button
            size="sm"
            variant="outline"
            className="shrink-0 h-7 px-2.5 text-xs"
            onClick={(e) => {
              e.stopPropagation();
              onViewError(module);
            }}
          >
            Ver detalles
          </Button>
        )}
      </div>
    );
  }
  return null;
}
