import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  PageHeader,
  SearchInput,
  FilterBar,
  EmptyState,
  ErrorState,
  Skeleton,
  Tabs,
  TabsList,
  TabsTrigger,
  cn,
} from "@runly/ui";
import {
  Lock,
  Info,
  LayoutGrid,
  List,
  Building2,
  Tag,
  GitBranch,
  AlertCircle,
  RefreshCw,
  Upload,
  Package,
} from "lucide-react";
import {
  ModuleIcon,
  resolveModuleVisuals,
  toAlphaHexColor,
} from "../../../components/ModuleCard";
import { toast } from "sonner";
import { useAuth } from "../../../auth/AuthProvider";
import { runly } from "../../../lib/runly";
import { UploadModuleSheet } from "./UploadModuleSheet";
import {
  getModuleLaunchPath,
  isModuleAvailable,
  mergeRuntimeModules,
} from "../../../lib/runtimeModules";
import {
  getCategoryLabel,
  getPublisher,
  buildModuleErrorDetail,
} from "../lib/moduleCatalogHelpers";
import {
  CardAction,
  StatusPill,
  TYPE_FILTERS,
  STATUS_TABS,
} from "../components/ModuleCatalogCard";
import { ModuleDetailSheet } from "../components/ModuleDetailSheet";
import { ModuleCatalogDialogs } from "../components/ModuleCatalogDialogs";

function getFirstFiniteNumber(...values) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export default function ModuleCatalog() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { session, userProfile } = useAuth();
  const token = session?.access_token;
  const permissions = userProfile?.permissions ?? [];
  const isAdmin = Boolean(userProfile?.isAdmin);
  const hasPermission = (key) => isAdmin || permissions.includes(key);
  const canReadModules = hasPermission("core.modules.read");
  const canInstallModules = hasPermission("core.modules.create");
  const canDisableModules = hasPermission("core.modules.update");
  const canUninstallModules = hasPermission("core.modules.delete");
  const canUploadModules = hasPermission("core.modules.upload");
  const canPurgeModules = hasPermission("core.modules.purge");

  const modulesQuery = useQuery({
    queryKey: ["modules", token],
    queryFn: () => runly.modules.list(token),
    enabled: Boolean(token) && canReadModules,
    staleTime: 60000,
  });
  const runtimeModules = useMemo(
    () => mergeRuntimeModules(modulesQuery.data),
    [modulesQuery.data],
  );
  const isLoading = modulesQuery.isLoading;
  const isError = modulesQuery.isError;

  const [uploadSheetOpen, setUploadSheetOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState("all");
  const [filterValues, setFilterValues] = useState({});
  const [viewMode, setViewMode] = useState("grid");
  const [selectedModule, setSelectedModule] = useState(null);
  const [confirmUninstall, setConfirmUninstall] = useState(null);
  const [purgeOnUninstall, setPurgeOnUninstall] = useState(false);
  const [confirmCleanup, setConfirmCleanup] = useState(null);
  const [cleanupConfirmation, setCleanupConfirmation] = useState("");
  const [confirmDbPurge, setConfirmDbPurge] = useState(null);
  const [errorDialog, setErrorDialog] = useState({
    open: false,
    module: null,
    loading: false,
    detail: null,
  });

  const lifecycleMutation = useMutation({
    mutationFn: async ({ action, module, purge = false, mode }) => {
      const key = module.key;
      if (action === "install") {
        const manifest = module.manifest;
        if (!manifest) throw new Error("Manifiesto no disponible.");
        return runly.modules.install(manifest, token);
      }
      if (action === "retry-install")
        return runly.modules.retryInstall(key, token);
      if (action === "clear-error")
        return runly.modules.clearError(key, mode ?? "preserve-data", token);
      if (action === "cleanup")
        return runly.modules.cleanup(
          key,
          "purge-empty-tables",
          cleanupConfirmation,
          token,
        );
      if (action === "disable") return runly.modules.disable(key, token);
      if (action === "enable") return runly.modules.enable(key, token);
      if (action === "sync-module") {
        return runly.modules.sync(token, { autoRepair: true, moduleKey: key });
      }
      if (action === "uninstall") {
        if (purge) {
          const policy = module?.manifest?.lifecycle?.defaultUninstallPolicy;
          const uninstallMode =
            policy === "purge-owned-tables"
              ? "purge-owned-tables"
              : "purge-data";
          return runly.modules.uninstallExplicit(
            key,
            uninstallMode,
            "ACEPTO",
            token,
          );
        }
        return runly.modules.uninstall(key, token);
      }
      if (action === "purge-orphaned-tables") {
        return runly.modules.uninstallExplicit(
          key,
          "purge-owned-tables",
          "ACEPTO",
          token,
        );
      }
      if (action === "seed") return runly.modules.seed(key, token);
    },
    onMutate: ({ action }) => {
      const loadingLabels = {
        install: "Instalando módulo...",
        "retry-install": "Reintentando instalación...",
        "clear-error": "Restaurando estado del módulo...",
        cleanup: "Limpiando intento fallido...",
        disable: "Deshabilitando módulo...",
        enable: "Habilitando módulo...",
        "sync-module": "Sincronizando módulo...",
        uninstall: "Desinstalando módulo...",
        "purge-orphaned-tables": "Purgando tablas del módulo...",
        seed: "Ejecutando seed...",
      };
      const toastId = toast.loading(
        loadingLabels[action] ?? "Procesando módulo...",
      );
      return { toastId };
    },
    onSuccess: async (_, { action }, context) => {
      await queryClient.invalidateQueries({ queryKey: ["modules"] });
      await queryClient.invalidateQueries({ queryKey: ["runtime-modules"] });
      await queryClient.invalidateQueries({ queryKey: ["blueprints"] });
      await queryClient.invalidateQueries({
        queryKey: ["module-orphan-tables"],
      });
      setConfirmUninstall(null);
      setPurgeOnUninstall(false);
      setConfirmCleanup(null);
      setCleanupConfirmation("");
      setConfirmDbPurge(null);
      const labels = {
        install: "instalado",
        "retry-install": "reinstalado",
        "clear-error": "restaurado a sin instalar",
        cleanup: "limpiado",
        disable: "deshabilitado",
        enable: "habilitado",
        "sync-module": "sincronizado",
        uninstall: "desinstalado",
        "purge-orphaned-tables": "purgado de la base de datos",
        seed: "seed ejecutado",
      };
      toast.success(`Módulo ${labels[action] ?? "actualizado"}`, {
        id: context?.toastId,
      });
    },
    onError: (err, _vars, context) => {
      const fallback = "No se pudo actualizar el módulo";
      try {
        const msg = JSON.parse(err?.message ?? "{}").error;
        toast.error(msg ?? fallback, { id: context?.toastId });
      } catch {
        toast.error(err?.message || fallback, { id: context?.toastId });
      }
    },
  });

  const syncCatalogMutation = useMutation({
    mutationFn: (vars) =>
      runly.modules.sync(token, { autoRepair: true, ...(vars ?? {}) }),
    onMutate: (vars) => {
      const toastId = toast.loading(
        vars?.moduleKey
          ? `Sincronizando ${vars.moduleKey}...`
          : "Sincronizando módulos...",
      );
      return { toastId, moduleKey: vars?.moduleKey ?? null };
    },
    onSuccess: async (result, _vars, context) => {
      await queryClient.invalidateQueries({ queryKey: ["modules"] });
      await queryClient.invalidateQueries({ queryKey: ["runtime-modules"] });
      await queryClient.invalidateQueries({ queryKey: ["blueprints"] });
      const summary = result?.summary ?? result?.data ?? result ?? {};
      const totals = summary?.totals ?? {};
      const automation = summary?.automation ?? {};
      const discovered = getFirstFiniteNumber(
        summary?.discovered,
        totals?.discovered,
      );
      const valid = getFirstFiniteNumber(summary?.valid, totals?.valid);
      const invalid = getFirstFiniteNumber(
        summary?.invalid,
        totals?.invalid,
        summary?.errored,
        totals?.errored,
      );
      const hasCounts = [discovered, valid, invalid].every((n) => n !== null);
      const scope = summary?.scope ?? {};
      const scopedModuleKey = scope?.moduleKey ?? context?.moduleKey ?? null;
      const autoSummary =
        automation?.autoRepairEnabled === true
          ? ` Auto: ${Number(automation?.modulesScanned ?? 0)} escaneados, ${Number(automation?.checksumsFixed ?? 0)} checksums corregidos, ${Number(automation?.versionsBumped ?? 0)} versiones ajustadas, ${Number(automation?.reinstalled ?? 0)} reinstalados, ${Number(automation?.failed ?? 0)} fallidos.`
          : "";
      const failedModules = Array.isArray(automation?.failedModules)
        ? automation.failedModules
        : [];

      if (hasCounts) {
        const scopePrefix = scopedModuleKey
          ? `Módulo sincronizado (${scopedModuleKey}): `
          : "Catálogo sincronizado: ";
        const message = `${scopePrefix}${discovered} descubierto${discovered === 1 ? "" : "s"}, ${valid} válido${valid === 1 ? "" : "s"}, ${invalid} inválido${invalid === 1 ? "" : "s"}.${autoSummary}`;
        if (Number(automation?.failed ?? 0) > 0) {
          toast.warning(message, {
            id: context?.toastId,
            action: {
              label: "Ver detalle",
              onClick: () => {
                const detail = failedModules
                  .map((item) => {
                    const key = item?.key ?? "módulo";
                    const stage = item?.stage ? ` (${item.stage})` : "";
                    const msg = item?.message ?? "Error desconocido";
                    return `${key}${stage}: ${msg}`;
                  })
                  .join(" | ");
                toast.error(
                  detail || "Hay errores en la automatización de módulos.",
                );
              },
            },
          });
          return;
        }

        toast.success(message, { id: context?.toastId });
      } else {
        const scopePrefix = scopedModuleKey
          ? `Módulo sincronizado (${scopedModuleKey})`
          : "Catálogo sincronizado correctamente";
        toast.success(`${scopePrefix}.${autoSummary}`, {
          id: context?.toastId,
        });
      }
    },
    onError: (error, _vars, context) => {
      if (error?.status === 403) {
        toast.error(
          "No tienes permisos para sincronizar el catálogo de módulos.",
          { id: context?.toastId },
        );
        return;
      }
      toast.error("No se pudo sincronizar el catálogo de módulos.", {
        id: context?.toastId,
      });
    },
  });

  async function handleViewError(module) {
    setErrorDialog({
      open: true,
      module,
      loading: true,
      detail: null,
    });
    try {
      const response = await runly.modules.getError(module.key, token);
      const err = response?.data?.lastError;
      const fallback =
        module?.lastError ?? module?.lifecycleConfig?.lastError ?? null;
      const detail = buildModuleErrorDetail(module, err ?? fallback);
      setErrorDialog({
        open: true,
        module,
        loading: false,
        detail,
      });
    } catch {
      const fallback =
        module?.lastError ?? module?.lifecycleConfig?.lastError ?? null;
      setErrorDialog({
        open: true,
        module,
        loading: false,
        detail: buildModuleErrorDetail(module, fallback),
      });
    }
  }

  async function handleCopyErrorDetails() {
    const text = String(errorDialog?.detail?.copyText ?? "").trim();
    if (!text) {
      toast.error("No hay detalle para copiar.");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Detalle copiado al portapapeles.");
    } catch {
      toast.error("No se pudo copiar automáticamente.");
    }
  }

  function handleAction(action, module, options = {}) {
    lifecycleMutation.mutate({ action, module, ...options });
  }

  const sortedModules = useMemo(
    () =>
      [...runtimeModules].sort((a, b) => {
        if (a.core !== b.core) return a.core ? -1 : 1;
        return a.name.localeCompare(b.name, "es", { sensitivity: "base" });
      }),
    [runtimeModules],
  );

  const counts = useMemo(
    () => ({
      all: sortedModules.length,
      INSTALLED: sortedModules.filter(
        (m) => m.status === "INSTALLED" && m.enabled,
      ).length,
      DISABLED: sortedModules.filter((m) => m.status === "DISABLED").length,
      UNINSTALLED: sortedModules.filter((m) => m.status === "UNINSTALLED")
        .length,
    }),
    [sortedModules],
  );

  const filteredModules = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sortedModules.filter((m) => {
      if (
        q &&
        !m.name.toLowerCase().includes(q) &&
        !m.key.toLowerCase().includes(q) &&
        !(m.summary ?? "").toLowerCase().includes(q)
      )
        return false;
      if (activeTab !== "all") {
        if (
          activeTab === "INSTALLED" &&
          !(m.status === "INSTALLED" && m.enabled)
        )
          return false;
        if (activeTab !== "INSTALLED" && m.status !== activeTab) return false;
      }
      if (filterValues.type) {
        const t = m.core ? "core" : "feature";
        if (t !== filterValues.type) return false;
      }
      if (filterValues.compat) {
        const blocked = m.compatibilityStatus === "BLOCKED";
        if (filterValues.compat === "ok" && blocked) return false;
        if (filterValues.compat === "blocked" && !blocked) return false;
      }
      return true;
    });
  }, [sortedModules, search, activeTab, filterValues]);

  const runtimeByKey = useMemo(
    () => new Map(runtimeModules.map((m) => [m.key, m])),
    [runtimeModules],
  );

  useEffect(() => {
    if (!selectedModule?.key) return;
    const fresh = runtimeByKey.get(selectedModule.key);
    if (!fresh || fresh === selectedModule) return;
    setSelectedModule(fresh);
  }, [runtimeByKey, selectedModule]);

  const redirectMessage = location.state?.moduleWarning;

  useEffect(() => {
    if (!redirectMessage) return;
    navigate(location.pathname, { replace: true, state: null });
  }, [redirectMessage, navigate, location.pathname]);

  function openModule(module) {
    if (!isModuleAvailable(module)) return;
    navigate(getModuleLaunchPath(module));
    setSelectedModule(null);
  }

  // ---- Skeleton loading ----
  const skeletons = Array.from({ length: 6 });

  return (
    <div className="flex flex-col min-h-full">
      <div className="flex-1 p-4 md:p-6 space-y-5">
        <PageHeader
          eyebrow="Runly Core"
          title="Catálogo de módulos"
          description="Gestiona el ciclo de vida de los módulos de tu instancia Runly."
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {canUploadModules && (
                <Button
                  variant="outline"
                  onClick={() => setUploadSheetOpen(true)}
                >
                  <Upload className="h-4 w-4" />
                  Subir módulo
                </Button>
              )}
              <Button
                variant="default"
                className="bg-(--brand-primary) text-(--brand-primary-foreground) hover:bg-(--brand-primary-hover) shadow-sm"
                disabled={
                  syncCatalogMutation.isPending || !canReadModules || !token
                }
                onClick={() => syncCatalogMutation.mutate()}
              >
                <RefreshCw
                  className={cn(
                    "h-4 w-4",
                    syncCatalogMutation.isPending && "animate-spin",
                  )}
                />
                {syncCatalogMutation.isPending
                  ? "Sincronizando..."
                  : "Sincronizar módulos"}
              </Button>
            </div>
          }
        />

        {redirectMessage && (
          <div className="rounded-xl border border-amber-400 dark:border-amber-800 bg-amber-100 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 text-sm px-4 py-3">
            {redirectMessage}
          </div>
        )}

        {!canInstallModules && !canDisableModules && !canUninstallModules && (
          <div className="flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/50 text-sm px-4 py-2.5 text-[hsl(var(--muted-foreground))]">
            <Info className="h-4 w-4 shrink-0" />
            La gestion del ciclo de vida depende de permisos de core.modules.
          </div>
        )}

        {/* Status tabs */}
        <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0 pb-0.5">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="h-9 gap-0.5">
              {STATUS_TABS.map((tab) => (
                <TabsTrigger
                  key={tab.value}
                  value={tab.value}
                  className="text-xs gap-1.5"
                >
                  {tab.label}
                  <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[hsl(var(--muted))] text-[10px] font-medium px-1 tabular-nums">
                    {counts[tab.value] ?? 0}
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>

        {/* Toolbar: search + filters + view toggle */}
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar módulo, categoría o clave..."
            className="w-full sm:max-w-sm"
          />
          <FilterBar
            filters={TYPE_FILTERS}
            value={filterValues}
            onChange={setFilterValues}
          />

          <span className="text-xs text-[hsl(var(--muted-foreground))] tabular-nums">
            {filteredModules.length} resultado
            {filteredModules.length !== 1 ? "s" : ""}
          </span>

          {/* View toggle */}
          <div className="ml-auto flex items-center gap-0.5 rounded-lg border border-[hsl(var(--border))] p-0.5 bg-[hsl(var(--muted))]/40">
            <button
              aria-label="Vista cuadrícula"
              onClick={() => setViewMode("grid")}
              className={cn(
                "h-7 w-7 flex items-center justify-center rounded-md transition-colors cursor-pointer",
                viewMode === "grid"
                  ? "bg-[hsl(var(--card))] text-[hsl(var(--foreground))] shadow-sm"
                  : "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]",
              )}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </button>
            <button
              aria-label="Vista lista"
              onClick={() => setViewMode("list")}
              className={cn(
                "h-7 w-7 flex items-center justify-center rounded-md transition-colors cursor-pointer",
                viewMode === "list"
                  ? "bg-[hsl(var(--card))] text-[hsl(var(--foreground))] shadow-sm"
                  : "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]",
              )}
            >
              <List className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Content */}
        {!canReadModules ? (
          <EmptyState
            icon={Lock}
            title="Sin acceso al catalogo"
            description="Necesitas core.modules.read para consultar el catalogo administrativo."
          />
        ) : isLoading ? (
          viewMode === "grid" ? (
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
              {skeletons.map((_, i) => (
                <Skeleton key={i} className="h-56 w-full rounded-2xl" />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {skeletons.map((_, i) => (
                <Skeleton key={i} className="h-16 w-full rounded-xl" />
              ))}
            </div>
          )
        ) : isError ? (
          <ErrorState
            title="Error al cargar módulos"
            onRetry={() =>
              queryClient.invalidateQueries({ queryKey: ["modules"] })
            }
          />
        ) : filteredModules.length === 0 ? (
          <EmptyState
            icon={Package}
            title="Sin resultados"
            description="Ningún módulo coincide con los filtros actuales."
            action={{
              label: "Limpiar filtros",
              onClick: () => {
                setSearch("");
                setFilterValues({});
                setActiveTab("all");
              },
            }}
          />
        ) : viewMode === "grid" ? (
          // ---- GRID VIEW ----
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
            {filteredModules.map((module) => {
              const visuals = resolveModuleVisuals(module);
              const color = visuals.color;
              const accentColor = visuals.accentColor;
              const blocked = module.compatibilityStatus === "BLOCKED";
              const isDisabled = module.status === "DISABLED";
              const inFlight =
                lifecycleMutation.isPending &&
                lifecycleMutation.variables?.module?.key === module.key;

              return (
                <div
                  key={module.key}
                  onClick={() => setSelectedModule(module)}
                  className={cn(
                    "group relative cursor-pointer rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-hidden flex flex-col",
                    "transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 active:scale-[0.99]",
                    isDisabled && "opacity-70",
                  )}
                >
                  {/* Gradient header */}
                  <div
                    className="relative h-18 overflow-hidden shrink-0"
                    style={{
                      background: `linear-gradient(135deg, ${toAlphaHexColor(color, "22")} 0%, ${toAlphaHexColor(accentColor, "08")} 70%, transparent 100%)`,
                    }}
                  >
                    {/* Decorative blobs */}
                    <div
                      className="absolute -right-6 -top-6 h-24 w-24 rounded-full opacity-[0.12]"
                      style={{ background: accentColor }}
                    />
                    <div
                      className="absolute right-8 top-2 h-10 w-10 rounded-full opacity-[0.08]"
                      style={{ background: color }}
                    />
                    {/* Status top-right */}
                    <div className="absolute top-3 right-3">
                      <StatusPill module={module} />
                    </div>
                    {/* Lock badge top-left */}
                    {module.core && (
                      <div className="absolute top-3 left-3">
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[hsl(var(--muted-foreground))] bg-[hsl(var(--background))]/70 backdrop-blur-sm border border-[hsl(var(--border))] rounded-full px-1.5 py-0.5">
                          <Lock className="h-2.5 w-2.5" />
                          Core
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Module icon overlapping header/body boundary */}
                  <div className="px-4 -mt-5 relative z-10 shrink-0">
                    <ModuleIcon module={module} size="md" />
                  </div>

                  {/* Card body */}
                  <div className="flex flex-col flex-1 pt-2 px-4 pb-4 space-y-2.5">
                    {/* Name + publisher */}
                    <div>
                      <p className="text-sm font-bold leading-tight truncate">
                        {module.name}
                      </p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <Building2 className="h-2.5 w-2.5 text-[hsl(var(--muted-foreground))] shrink-0" />
                        <p className="text-[11px] text-[hsl(var(--muted-foreground))] truncate">
                          {getPublisher(module)}
                        </p>
                      </div>
                    </div>

                    {/* Description */}
                    <p className="text-xs text-[hsl(var(--muted-foreground))] leading-relaxed line-clamp-3 flex-1">
                      {module.description ||
                        module.summary ||
                        "Sin descripción disponible para este módulo."}
                    </p>
                    {/* Footer: meta + action */}
                    <div className="flex items-center justify-between gap-2 pt-0.5">
                      <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                        {/* Category */}
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[hsl(var(--muted-foreground))] border border-[hsl(var(--border))] rounded-full px-1.5 py-0.5 shrink-0">
                          <Tag className="h-2.5 w-2.5" />
                          {getCategoryLabel(module)}
                        </span>
                        {/* Version */}
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[hsl(var(--muted-foreground))] border border-[hsl(var(--border))] rounded-full px-1.5 py-0.5 shrink-0">
                          <GitBranch className="h-2.5 w-2.5" />v{module.version}
                        </span>
                        {/* Blocked */}
                        {blocked && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-full px-1.5 py-0.5 shrink-0">
                            <AlertCircle className="h-2.5 w-2.5" />
                            Bloqueado
                          </span>
                        )}
                        {module.updateAvailable && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800 rounded-full px-1.5 py-0.5 shrink-0">
                            <RefreshCw className="h-2.5 w-2.5" />
                            Actualización pendiente
                          </span>
                        )}
                      </div>
                      {!inFlight && (
                        <CardAction
                          module={module}
                          canInstallModules={canInstallModules}
                          canDisableModules={canDisableModules}
                          onAction={handleAction}
                          onOpen={openModule}
                          onViewError={handleViewError}
                        />
                      )}
                      {inFlight && (
                        <span className="text-xs text-[hsl(var(--muted-foreground))] animate-pulse shrink-0">
                          Procesando...
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          // ---- LIST VIEW ----
          <div className="rounded-2xl border border-[hsl(var(--border))] overflow-hidden divide-y divide-[hsl(var(--border))]">
            {filteredModules.map((module, idx) => {
              const blocked = module.compatibilityStatus === "BLOCKED";
              const isDisabled = module.status === "DISABLED";
              const inFlight =
                lifecycleMutation.isPending &&
                lifecycleMutation.variables?.module?.key === module.key;

              return (
                <div
                  key={module.key}
                  onClick={() => setSelectedModule(module)}
                  className={cn(
                    "group flex items-center gap-3 px-4 py-3 cursor-pointer bg-[hsl(var(--card))]",
                    "transition-colors duration-150 hover:bg-[hsl(var(--muted))]/50",
                    isDisabled && "opacity-70",
                    idx === 0 && "rounded-t-2xl",
                    idx === filteredModules.length - 1 && "rounded-b-2xl",
                  )}
                >
                  {/* Icon */}
                  <ModuleIcon module={module} size="sm" />

                  {/* Name + key */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <p className="text-sm font-semibold truncate">
                        {module.name}
                      </p>
                      {module.core && (
                        <Lock className="h-3 w-3 text-[hsl(var(--muted-foreground))] shrink-0" />
                      )}
                    </div>
                    <p className="text-[11px] text-[hsl(var(--muted-foreground))] truncate">
                      {getPublisher(module)} · {module.key}
                    </p>
                  </div>

                  {/* Category */}
                  <span className="hidden md:inline-flex text-[11px] text-[hsl(var(--muted-foreground))] font-medium border border-[hsl(var(--border))] rounded-full px-2 py-0.5 shrink-0">
                    {getCategoryLabel(module)}
                  </span>

                  {/* Version */}
                  <span className="hidden lg:inline text-[11px] text-[hsl(var(--muted-foreground))] font-mono shrink-0">
                    v{module.version}
                  </span>

                  {/* Status */}
                  <StatusPill
                    module={module}
                    className="hidden sm:flex shrink-0"
                  />

                  {/* Blocked badge */}
                  {blocked && (
                    <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-medium text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-full px-1.5 py-0.5 shrink-0">
                      <AlertCircle className="h-2.5 w-2.5" />
                      Bloqueado
                    </span>
                  )}
                  {module.updateAvailable && (
                    <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-medium text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800 rounded-full px-1.5 py-0.5 shrink-0">
                      <RefreshCw className="h-2.5 w-2.5" />
                      Pendiente
                    </span>
                  )}

                  {/* Action */}
                  <div
                    className="shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {!inFlight ? (
                      <CardAction
                        module={module}
                        canInstallModules={canInstallModules}
                        canDisableModules={canDisableModules}
                        onAction={handleAction}
                        onOpen={openModule}
                        onViewError={handleViewError}
                      />
                    ) : (
                      <span className="text-xs text-[hsl(var(--muted-foreground))] animate-pulse">
                        Procesando...
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Module detail sheet */}
      <ModuleDetailSheet
        module={selectedModule}
        open={Boolean(selectedModule)}
        onOpenChange={(v) => !v && setSelectedModule(null)}
        token={token}
        canInstallModules={canInstallModules}
        canDisableModules={canDisableModules}
        canUninstallModules={canUninstallModules}
        canPurgeModules={canPurgeModules}
        lifecycleMutation={lifecycleMutation}
        queryClient={queryClient}
        navigate={navigate}
        onClose={() => setSelectedModule(null)}
        onOpenModule={openModule}
        onViewError={handleViewError}
        onConfirmCleanup={setConfirmCleanup}
        onConfirmUninstall={setConfirmUninstall}
        onConfirmDbPurge={setConfirmDbPurge}
      />

      <ModuleCatalogDialogs
        errorDialog={errorDialog}
        setErrorDialog={setErrorDialog}
        onCopyErrorDetails={handleCopyErrorDetails}
        confirmUninstall={confirmUninstall}
        setConfirmUninstall={setConfirmUninstall}
        purgeOnUninstall={purgeOnUninstall}
        setPurgeOnUninstall={setPurgeOnUninstall}
        confirmCleanup={confirmCleanup}
        setConfirmCleanup={setConfirmCleanup}
        cleanupConfirmation={cleanupConfirmation}
        setCleanupConfirmation={setCleanupConfirmation}
        confirmDbPurge={confirmDbPurge}
        setConfirmDbPurge={setConfirmDbPurge}
        lifecycleMutation={lifecycleMutation}
      />

      <UploadModuleSheet
        open={uploadSheetOpen}
        onOpenChange={setUploadSheetOpen}
        onSuccess={() => syncCatalogMutation.mutate()}
      />
    </div>
  );
}
