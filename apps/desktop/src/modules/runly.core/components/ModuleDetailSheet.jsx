// apps/desktop/src/modules/runly.core/components/ModuleDetailSheet.jsx
//
// The module catalog screen's detail Sheet: hero header, status/compat
// badges, description, metadata grid, dependencies, and the full lifecycle
// action list (SheetActions). Extracted from ModuleCatalog.jsx on
// 2026-09-25 to keep that file under the CLAUDE.md 1000-line limit — this
// was by far the largest single chunk of that screen. All server state
// (queries/mutations) is still owned by the parent screen and threaded in
// as props; only the local purge-confirm dialog's open/pending state is
// genuinely local to this component, same as it was when nested inline.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Badge,
  Button,
  cn,
  ConfirmDialog,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@runly/ui";
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  Database,
  ExternalLink,
  Home,
  Lock,
  Power,
  PowerOff,
  RefreshCw,
  Sprout,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  ModuleIcon,
  resolveModuleVisuals,
  toAlphaHexColor,
} from "../../../components/ModuleCard";
import { isModuleAvailable } from "../../../lib/runtimeModules";
import { runly } from "../../../lib/runly";
import {
  KIND_LABEL,
  STATUS_DOT,
  getCategoryLabel,
  getPublisher,
  isLocked,
  statusLabel,
} from "../lib/moduleCatalogHelpers";

// ---- Sheet action panel ----
function SheetActions({
  module,
  token,
  canInstallModules,
  canDisableModules,
  canUninstallModules,
  canPurgeModules,
  lifecycleMutation,
  queryClient,
  navigate,
  onClose,
  onOpenModule,
  onViewError,
  onConfirmCleanup,
  onConfirmUninstall,
  onConfirmDbPurge,
}) {
  const inFlight =
    lifecycleMutation.isPending &&
    lifecycleMutation.variables?.module?.key === module.key;
  const locked = isLocked(module);
  const canOpen = isModuleAvailable(module);
  const canSyncModule =
    canOpen && module.updateAvailable && canInstallModules;
  const canInstall = module.status === "UNINSTALLED";
  const canDisable =
    module.status === "INSTALLED" && module.enabled && !locked;
  const canEnable = module.status === "DISABLED" && !locked;
  const canRetryInstall = module.status === "ERROR" && !locked;
  const canClearError = module.status === "ERROR" && !locked;
  const canCleanupFailedInstall =
    module.status === "ERROR" &&
    !locked &&
    canUninstallModules &&
    Array.isArray(module?.lifecycleConfig?.ownedTables) &&
    module.lifecycleConfig.ownedTables.length > 0;
  const canUninstall =
    (module.status === "INSTALLED" || module.status === "DISABLED") &&
    !locked;
  const canPurge =
    canPurgeModules &&
    (module.status === "UNINSTALLED" || module.status === "DISABLED") &&
    !module.core;
  const [purgeDialogOpen, setPurgeDialogOpen] = useState(false);
  const [isPurging, setIsPurging] = useState(false);

  async function handlePurge() {
    if (!token) return;
    setIsPurging(true);
    const toastId = toast.loading(`Purgando ${module.name}...`);
    try {
      const result = await runly.modules.purgeModule(module.key, token);
      if (result?.error) {
        toast.error(result.error, { id: toastId });
        return;
      }
      toast.success(`Módulo ${module.name} eliminado del servidor`, {
        id: toastId,
      });
      onClose();
      queryClient.invalidateQueries({ queryKey: ["modules"] });
      queryClient.invalidateQueries({ queryKey: ["runtime-modules"] });
    } catch (err) {
      toast.error("Error al purgar el módulo", {
        id: toastId,
        description: err?.message ?? "Error desconocido",
      });
    } finally {
      setIsPurging(false);
      setPurgeDialogOpen(false);
    }
  }
  const couldHaveOrphanedTables =
    module.status === "UNINSTALLED" &&
    !locked &&
    canUninstallModules &&
    ((Array.isArray(module?.lifecycleConfig?.ownedTables) &&
      module.lifecycleConfig.ownedTables.length > 0) ||
      module?.manifest?.lifecycle?.defaultUninstallPolicy ===
        "purge-owned-tables");

  const orphanQuery = useQuery({
    queryKey: ["module-orphan-tables", module.key],
    queryFn: () =>
      runly.modules.uninstallDryRun(module.key, token, "purge-owned-tables"),
    enabled: Boolean(couldHaveOrphanedTables && token),
    staleTime: 60000,
    retry: false,
  });

  const hasOrphanedTables = (
    orphanQuery.data?.data?.ownedTablePurge?.tableChecks ?? []
  ).some((t) => t.exists);
  const canPurgeOrphanedTables = couldHaveOrphanedTables && hasOrphanedTables;
  return (
    <div className="space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
        Acciones del módulo
      </p>
      {canOpen && (
        <Button
          className="w-full bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-400"
          disabled={inFlight}
          onClick={() => onOpenModule(module)}
        >
          <ExternalLink className="h-4 w-4" />
          Abrir módulo
        </Button>
      )}
      {canSyncModule && (
        <Button
          className="w-full bg-sky-600 text-white hover:bg-sky-700 dark:bg-sky-500 dark:hover:bg-sky-400"
          disabled={inFlight}
          onClick={() =>
            lifecycleMutation.mutate({ action: "sync-module", module })
          }
        >
          <RefreshCw className="h-4 w-4" />
          {inFlight ? "Sincronizando..." : "Sincronizar este módulo"}
        </Button>
      )}
      {!locked && module.status === "INSTALLED" && module.enabled && (
        <Button
          className="w-full"
          variant="outline"
          disabled={inFlight}
          onClick={() => lifecycleMutation.mutate({ action: "seed", module })}
        >
          <Sprout className="h-4 w-4" />
          {inFlight ? "Ejecutando..." : "Ejecutar seed"}
        </Button>
      )}
      {canInstall && (
        <Button
          className="w-full bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-400"
          disabled={!canInstallModules || inFlight}
          onClick={() =>
            lifecycleMutation.mutate({ action: "install", module })
          }
        >
          {inFlight ? "Instalando..." : "Instalar módulo"}
        </Button>
      )}
      {canRetryInstall && (
        <Button
          className="w-full bg-amber-400 text-amber-950 hover:bg-amber-500 dark:bg-amber-300 dark:hover:bg-amber-200"
          disabled={!canInstallModules || inFlight}
          onClick={() =>
            lifecycleMutation.mutate({ action: "retry-install", module })
          }
        >
          <RefreshCw className="h-4 w-4" />
          {inFlight ? "Reintentando..." : "Reintentar instalación"}
        </Button>
      )}
      {canClearError && (
        <Button
          className="w-full"
          variant="outline"
          disabled={!canDisableModules || inFlight}
          onClick={() =>
            lifecycleMutation.mutate({
              action: "clear-error",
              module,
              mode: "preserve-data",
            })
          }
        >
          Restaurar a sin instalar
        </Button>
      )}
      {canCleanupFailedInstall && (
        <Button
          className="w-full"
          variant="outline"
          disabled={inFlight}
          onClick={() => {
            onConfirmCleanup(module);
            onClose();
          }}
        >
          Limpiar intento fallido
        </Button>
      )}
      {module.status === "ERROR" && (
        <Button
          className="w-full"
          variant="outline"
          disabled={inFlight}
          onClick={() => onViewError(module)}
        >
          Ver error
        </Button>
      )}
      {canEnable && (
        <Button
          className="w-full bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-400"
          disabled={!canDisableModules || inFlight}
          onClick={() =>
            lifecycleMutation.mutate({ action: "enable", module })
          }
        >
          <Power className="h-4 w-4" />
          {inFlight ? "Habilitando..." : "Habilitar"}
        </Button>
      )}
      {canDisable && (
        <Button
          className="w-full"
          variant="outline"
          disabled={!canDisableModules || inFlight}
          onClick={() =>
            lifecycleMutation.mutate({ action: "disable", module })
          }
        >
          <PowerOff className="h-4 w-4" />
          {inFlight ? "Deshabilitando..." : "Deshabilitar"}
        </Button>
      )}
      {canUninstall && (
        <Button
          className="w-full"
          variant="destructive"
          disabled={!canUninstallModules || inFlight}
          onClick={() => {
            onConfirmUninstall(module);
            onClose();
          }}
        >
          <Trash2 className="h-4 w-4" />
          Desinstalar módulo
        </Button>
      )}
      {canPurgeOrphanedTables && (
        <Button
          className="w-full"
          variant="outline"
          disabled={inFlight}
          onClick={() => {
            onConfirmDbPurge(module);
            onClose();
          }}
        >
          <Database className="h-4 w-4 text-red-500" />
          <span className="text-red-600 dark:text-red-400">
            Purgar tablas de base de datos
          </span>
        </Button>
      )}
      {locked && !canOpen && (
        <div className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))] bg-[hsl(var(--muted))] rounded-xl px-3 py-2.5">
          <Lock className="h-3.5 w-3.5 shrink-0" />
          Módulo core protegido — no puede modificarse.
        </div>
      )}
      {canPurge && (
        <>
          <div className="border-t border-[hsl(var(--border))] pt-3 mt-1">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))] mb-2">
              Zona de peligro
            </p>
            <Button
              className="w-full border-red-500/50 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
              variant="outline"
              disabled={isPurging || inFlight}
              onClick={() => setPurgeDialogOpen(true)}
            >
              Eliminar módulo del servidor
            </Button>
          </div>
          <ConfirmDialog
            open={purgeDialogOpen}
            onOpenChange={setPurgeDialogOpen}
            title="Eliminar módulo del servidor"
            description={`Esta acción elimina permanentemente todos los archivos de "${module.name}" del servidor y su registro en la base de datos. No se puede deshacer.`}
            confirmLabel="Eliminar permanentemente"
            cancelLabel="Cancelar"
            loading={isPurging}
            onConfirm={handlePurge}
          />
        </>
      )}
      <Button
        className="w-full"
        variant="ghost"
        onClick={() => {
          navigate("/app/home");
          onClose();
        }}
      >
        <Home className="h-4 w-4" />
        Ir al inicio
      </Button>
    </div>
  );
}

export function ModuleDetailSheet({
  module,
  open,
  onOpenChange,
  token,
  canInstallModules,
  canDisableModules,
  canUninstallModules,
  canPurgeModules,
  lifecycleMutation,
  queryClient,
  navigate,
  onClose,
  onOpenModule,
  onViewError,
  onConfirmCleanup,
  onConfirmUninstall,
  onConfirmDbPurge,
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md lg:max-w-xl xl:max-w-2xl overflow-y-auto">
        {module &&
          (() => {
            const visuals = resolveModuleVisuals(module);
            const color = visuals.color;
            const accentColor = visuals.accentColor;
            const blocked = module.compatibilityStatus === "BLOCKED";
            return (
              <div className="space-y-5">
                {/* Hero header */}
                <div
                  className="rounded-2xl p-5 flex items-start gap-4 -mx-1 relative overflow-hidden"
                  style={{
                    background: `linear-gradient(135deg, ${toAlphaHexColor(color, "18")} 0%, ${toAlphaHexColor(accentColor, "06")} 100%)`,
                  }}
                >
                  <div
                    className="absolute -right-8 -top-8 h-32 w-32 rounded-full opacity-10"
                    style={{ background: accentColor }}
                  />
                  <ModuleIcon module={module} size="lg" />
                  <div className="min-w-0 flex-1 pt-1">
                    <SheetHeader className="p-0">
                      <SheetTitle className="text-xl leading-tight text-left">
                        {module.name}
                      </SheetTitle>
                    </SheetHeader>
                    <div className="flex items-center gap-1 mt-0.5">
                      <Building2 className="h-3 w-3 text-[hsl(var(--muted-foreground))] shrink-0" />
                      <span className="text-xs text-[hsl(var(--muted-foreground))]">
                        {getPublisher(module)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Status + badges */}
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-1.5 rounded-full border border-[hsl(var(--border))] px-2.5 py-1">
                    <span
                      className={cn(
                        "h-2 w-2 rounded-full shrink-0",
                        module.status === "INSTALLED" &&
                          module.enabled &&
                          "shadow-[0_0_6px_rgba(34,197,94,0.65)]",
                      )}
                      style={{
                        backgroundColor: STATUS_DOT[module.status] ?? "#94a3b8",
                      }}
                    />
                    <span className="text-xs font-medium">
                      {statusLabel(module)}
                    </span>
                  </div>
                  {module.core && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-[hsl(var(--border))] px-2.5 py-1 text-xs font-medium text-[hsl(var(--muted-foreground))]">
                      <Lock className="h-3 w-3" />
                      Protegido
                    </span>
                  )}
                  {blocked ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-red-500/45 dark:border-red-400/35 bg-red-500/20 dark:bg-red-400/20 px-2.5 py-1 text-xs font-medium text-red-800 dark:text-red-200">
                      <AlertCircle className="h-3 w-3" />
                      Bloqueado
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/45 dark:border-emerald-400/35 bg-emerald-500/20 dark:bg-emerald-400/20 px-2.5 py-1 text-xs font-medium text-emerald-800 dark:text-emerald-200">
                      <CheckCircle2 className="h-3 w-3" />
                      Compatible
                    </span>
                  )}
                  {module.updateAvailable && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/45 dark:border-sky-400/35 bg-sky-500/20 dark:bg-sky-400/20 px-2.5 py-1 text-xs font-medium text-sky-800 dark:text-sky-200">
                      <RefreshCw className="h-3 w-3" />
                      Actualización pendiente
                    </span>
                  )}
                </div>

                {/* Description */}
                {(module.description || module.summary) && (
                  <div className="space-y-1">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
                      Descripción
                    </p>
                    <p className="text-sm leading-relaxed text-[hsl(var(--foreground))]">
                      {module.description || module.summary}
                    </p>
                  </div>
                )}

                {/* Metadata grid */}
                <div className="rounded-xl border border-[hsl(var(--border))] overflow-hidden divide-y divide-[hsl(var(--border))]">
                  {[
                    {
                      label: "Tipo",
                      value: KIND_LABEL[module.kind] ?? module.kind,
                    },
                    {
                      label: "Categoría",
                      value: getCategoryLabel(module),
                    },
                    { label: "Versión", value: `v${module.version}` },
                    ...(module.localVersion &&
                    module.localVersion !== module.version
                      ? [
                          {
                            label: "Versión local",
                            value: `v${module.localVersion}`,
                          },
                        ]
                      : []),
                    {
                      label: "Publicado por",
                      value: getPublisher(module),
                    },
                    { label: "Clave técnica", value: module.key },
                  ].map(({ label, value }) => (
                    <div
                      key={label}
                      className="flex items-center justify-between px-3 py-2.5 gap-4"
                    >
                      <span className="text-xs text-[hsl(var(--muted-foreground))] shrink-0">
                        {label}
                      </span>
                      <span className="text-xs font-medium text-right font-mono truncate max-w-[60%]">
                        {value}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Dependencies */}
                {module.compatibility?.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
                      Dependencias
                    </p>
                    <div className="space-y-1.5">
                      {module.compatibility.map((dep) => (
                        <div
                          key={dep.key}
                          className="flex items-center justify-between rounded-xl border border-[hsl(var(--border))] px-3 py-2.5 gap-2"
                        >
                          <div className="min-w-0">
                            <p className="text-xs font-medium truncate">
                              {dep.name || dep.key}
                            </p>
                            <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
                              {dep.required ? "Requerida" : "Opcional"}
                              {dep.versionRange ? ` · ${dep.versionRange}` : ""}
                            </p>
                          </div>
                          <Badge
                            variant={
                              dep.active
                                ? "success"
                                : dep.required
                                  ? "destructive"
                                  : "secondary"
                            }
                            className="shrink-0 text-xs"
                          >
                            {dep.active
                              ? "Activa"
                              : dep.required
                                ? "Falta"
                                : "Inactiva"}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="border-t border-[hsl(var(--border))] pt-4">
                  <SheetActions
                    module={module}
                    token={token}
                    canInstallModules={canInstallModules}
                    canDisableModules={canDisableModules}
                    canUninstallModules={canUninstallModules}
                    canPurgeModules={canPurgeModules}
                    lifecycleMutation={lifecycleMutation}
                    queryClient={queryClient}
                    navigate={navigate}
                    onClose={onClose}
                    onOpenModule={onOpenModule}
                    onViewError={onViewError}
                    onConfirmCleanup={onConfirmCleanup}
                    onConfirmUninstall={onConfirmUninstall}
                    onConfirmDbPurge={onConfirmDbPurge}
                  />
                </div>
              </div>
            );
          })()}
      </SheetContent>
    </Sheet>
  );
}
