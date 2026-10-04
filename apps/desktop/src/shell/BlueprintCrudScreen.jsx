import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Package, Plus } from "lucide-react";
import {
  RunlyRecordsView,
  RUNLY_RECORDS_VIEW_KINDS,
  fetchSignedUrl,
  Button,
  Card,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  normalizeSpanishLabel,
  shouldUsePageMode,
  extractBlueprintFields,
} from "@runly/ui";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { useActiveCompany } from "../company/ActiveCompanyProvider";
import { useRuntimeModules } from "../app/useRuntimeModules";
import { runly } from "../lib/runly";
import { getApiUrl } from "../lib/runtimeConfig.js";
import { isModuleAvailable } from "../lib/runtimeModules";
import { componentRegistry } from "../lib/moduleComponentRegistry";
import { resolveBlueprintPresentation } from "./blueprint-layout-resolver.js";
import { normalizePath } from '../lib/pathUtils'
import { useRecordShareAction } from "./useRecordShareAction.jsx";
import { CustomViewHost } from "./CustomViewHost.jsx";

const API_BASE_URL = getApiUrl();

import { createErpAdapters, BlueprintRenderer, normalizeKind, getBlueprintKind, getLastSegment, collapseWildcardPath, parseModeFromSegments, parseFallbackRouteInfo, getPagePath, resolveRouteInfo, matchesEntity, matchesCollectionPath, selectBlueprints, resolveNavItem, resolvePageTitle, resolveEmptyLabel, resolvePageDescription, getModuleRootPath, resolveGroupSegment, resolveCollectionPathFromPagePath, resolveGroupedTabs, isNamespacedComponentKey, collectNamespacedComponentKeys, collectMissingComponentReferences } from '@runly/preview-runtime';
const extractFields = extractBlueprintFields;

export function BlueprintCrudScreen() {
  const { moduleKey, "*": wildcard } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { session } = useAuth();
  const token = session?.access_token ?? null;
  const { activeCompanyId } = useActiveCompany();
  const adapters = useMemo(() => createErpAdapters({ baseUrl: API_BASE_URL, getToken: () => token, getCompanyId: () => activeCompanyId, resolveResource: (id) => fetchSignedUrl(API_BASE_URL, token, id, activeCompanyId) }), [token, activeCompanyId]);
  const authUserId = session?.user?.id ?? "anonymous";
  const { moduleMap } = useRuntimeModules();
  const module = moduleMap.get(moduleKey) ?? null;
  const moduleName = module?.name ?? module?.manifest?.name ?? moduleKey ?? "";
  const registryVersion = useSyncExternalStore(
    componentRegistry.subscribe,
    componentRegistry.getVersion,
    componentRegistry.getVersion,
  );
  const [isRepairingComponents, setIsRepairingComponents] = useState(false);

  useEffect(() => {
    const activeKeys = [];
    for (const row of moduleMap.values()) {
      if (isModuleAvailable(row)) {
        activeKeys.push(row.key);
      }
    }
    componentRegistry.setActiveModules(activeKeys, [...moduleMap.keys()]);
  }, [moduleMap]);

  const blueprintsQuery = useQuery({
    queryKey: ["blueprints", moduleKey, authUserId],
    queryFn: () => runly.blueprints.list(token),
    enabled: Boolean(token),
    staleTime: 30000,
  });

  const moduleRows = useMemo(() => {
    const rows = Array.isArray(blueprintsQuery.data?.data)
      ? blueprintsQuery.data.data
      : [];
    return rows.filter(
      (row) => row?.source === "runly-view" && row?.moduleKey === moduleKey,
    );
  }, [blueprintsQuery.data, moduleKey]);

  const retryModuleComponents = useCallback(async () => {
    if (!moduleKey) return;
    setIsRepairingComponents(true);
    try {
      // Best effort: this can rebuild module metadata/bundle if needed.
      try {
        await runly.modules.sync(token, { autoRepair: true, moduleKey });
      } catch (syncErr) {
        console.warn(
          `[BlueprintCrudScreen] modules.sync failed for ${moduleKey}:`,
          syncErr?.message ?? syncErr,
        );
      }

      const bundleUrl = new URL(`${API_BASE_URL}/modules/${moduleKey}/bundle.js`);
      bundleUrl.searchParams.set("web_origin", window.location.origin);
      bundleUrl.searchParams.set("t", String(Date.now()));

      const mod = await import(/* @vite-ignore */ bundleUrl.toString());
      if (typeof mod.register === "function") {
        await mod.register(componentRegistry);
      }

      await blueprintsQuery.refetch();
      toast.success("Componentes del módulo recargados.");
    } catch (err) {
      toast.error(
        `No se pudieron recargar los componentes: ${err?.message ?? "error desconocido"}`,
      );
    } finally {
      setIsRepairingComponents(false);
    }
  }, [blueprintsQuery, moduleKey, token]);

  const customBlueprint = useMemo(() => {
    const normalizedPathname = normalizePath(location.pathname)
    return (
      moduleRows.find(
        (row) =>
          getBlueprintKind(row) === 'CUSTOM' &&
          normalizePath(row?.schema?.path) === normalizedPathname
      ) ?? null
    )
  }, [moduleRows, location.pathname])

  const isCustomView = customBlueprint !== null

  const dashboardBlueprint = useMemo(() => {
    const normalizedPathname = normalizePath(location.pathname)
    return moduleRows.find((row) => getBlueprintKind(row) === 'DASHBOARD' && normalizePath(row?.schema?.path) === normalizedPathname) ?? null
  }, [moduleRows, location.pathname])

  const kanbanBlueprint = useMemo(() => {
    const normalizedPathname = normalizePath(location.pathname)
    return moduleRows.find((row) => getBlueprintKind(row) === 'KANBAN' && normalizePath(row?.schema?.path) === normalizedPathname) ?? null
  }, [moduleRows, location.pathname])

  // CARDS / CALENDAR / TIMELINE / REPORT views, routed by schema.path like KANBAN.
  const recordsViewBlueprint = useMemo(() => {
    const normalizedPathname = normalizePath(location.pathname)
    return moduleRows.find((row) => RUNLY_RECORDS_VIEW_KINDS.includes(getBlueprintKind(row)) && normalizePath(row?.schema?.path) === normalizedPathname) ?? null
  }, [moduleRows, location.pathname])

  // Kanban cards and records views open the entity's detail on the page that
  // hosts its TABLE view.
  const dataViewEntity = kanbanBlueprint?.schema?.entity ?? recordsViewBlueprint?.schema?.entity ?? null
  const kanbanDetailPath = useMemo(() => {
    if (!dataViewEntity) return null
    const table = moduleRows.find((row) => getBlueprintKind(row) === 'TABLE' && row?.schema?.entity === dataViewEntity)
    const page = table && moduleRows.find((row) => getBlueprintKind(row) === 'PAGE' && (row?.schema?.view === table.key || row?.schema?.page?.view === table.key))
    return getPagePath(page)
  }, [dataViewEntity, moduleRows])

  const routeInfo = useMemo(
    () =>
      resolveRouteInfo({
        moduleKey,
        wildcard,
        pathname: location.pathname,
        moduleRows,
      }),
    [location.pathname, moduleKey, moduleRows, wildcard],
  );

  const selection = useMemo(
    () => selectBlueprints({ moduleRows, routeInfo }),
    [moduleRows, routeInfo],
  );

  const { extraDetailActions, shareDialog } = useRecordShareAction({
    moduleKey,
    entity: selection?.detailBlueprint?.schema?.entity ?? selection?.tableBlueprint?.schema?.entity ?? null,
    token,
    companyId: activeCompanyId,
    apiBaseUrl: API_BASE_URL,
  });

  const presentation = useMemo(
    () =>
      resolveBlueprintPresentation({
        pageBlueprint: routeInfo.pageMatch,
        tableBlueprint: selection.tableBlueprint,
        formBlueprint: selection.formBlueprint,
        detailBlueprint: selection.detailBlueprint,
      }),
    [
      routeInfo.pageMatch,
      selection.detailBlueprint,
      selection.formBlueprint,
      selection.tableBlueprint,
    ],
  );

  const fields = useMemo(
    () =>
      extractFields(
        selection.tableBlueprint,
        selection.formBlueprint,
        selection.detailBlueprint,
      ),
    [
      selection.detailBlueprint,
      selection.formBlueprint,
      selection.tableBlueprint,
    ],
  );

  // When the form/detail renders as a Sheet (not a full page), we suppress URL
  // navigation for create/detail/edit modes so opening a sheet does not feel
  // like navigating to a different view.
  const isSheetMode = useMemo(
    () => !shouldUsePageMode(selection.formBlueprint?.schema, fields),
    [selection.formBlueprint, fields],
  );

  // Ref used to imperatively open the create sheet without touching the URL.
  const crudViewRef = useRef(null);

  const missingComponentRefs = useMemo(() => {
    if (isCustomView) return []
    return collectMissingComponentReferences({
      blueprints: [
        selection.tableBlueprint,
        selection.formBlueprint,
        selection.detailBlueprint,
      ].filter(Boolean),
      registry: componentRegistry,
    })
  }, [
    isCustomView,
    registryVersion,
    selection.detailBlueprint,
    selection.formBlueprint,
    selection.tableBlueprint,
  ]);

  const navItem = useMemo(
    () =>
      resolveNavItem(
        module,
        routeInfo.moduleRoutePath,
        routeInfo.collectionPath,
        routeInfo.entitySegment,
      ),
    [
      module,
      routeInfo.collectionPath,
      routeInfo.entitySegment,
      routeInfo.moduleRoutePath,
    ],
  );

  const groupedTabs = useMemo(
    () =>
      resolveGroupedTabs({
        moduleRows,
        moduleKey,
        routeInfo,
        pathname: location.pathname,
      }),
    [location.pathname, moduleKey, moduleRows, routeInfo],
  );

  // True when a sidebar nav group's children handle sub-navigation for this path.
  // In that case, the in-page tab bar is suppressed (sidebar IS the navigation).
  const navItemHasChildren = useMemo(() => {
    if (isCustomView) return false
    const nav = module?.navigation ?? module?.manifest?.navigation ?? [];
    const pathname = normalizePath(location.pathname);
    return nav.some((item) => {
      if (!item.children?.length) return false;
      return item.children.some((child) => {
        const childPath = normalizePath(child.path ?? "");
        if (!childPath) return false;
        return (
          pathname === childPath || pathname.startsWith(childPath + "/")
        );
      });
    });
  }, [isCustomView, module, location.pathname]);

  const showTabBar = Boolean(groupedTabs?.tabs?.length) && !navItemHasChildren;

  useEffect(() => {
    if (!groupedTabs?.shouldRedirect || !groupedTabs.defaultPath) return;
    navigate(groupedTabs.defaultPath, { replace: true });
  }, [groupedTabs?.defaultPath, groupedTabs?.shouldRedirect, navigate]);

  const locationPathnameRef = useRef(location.pathname);
  locationPathnameRef.current = location.pathname;

  const handleNavigate = useCallback(
    ({ mode, recordId }) => {
      // In sheet mode, suppress URL navigation ONLY for "create" mode.
      // Opening a new-record sheet should not navigate to /new — the user
      // is still on the list view and the sheet is a UI overlay.
      // Detail and edit still update the URL so deep links and browser-back
      // work correctly (e.g. /accounts/:id loads the AccountScreen).
      if (isSheetMode && mode === "create") return;

      const basePath =
        routeInfo.moduleRoutePath ||
        (routeInfo.collectionPath
          ? `/app/m/${moduleKey}/${routeInfo.collectionPath}`
          : null);
      if (!basePath) return;

      let targetPath = basePath;
      if (mode === "create") {
        targetPath = `${basePath}/new`;
      } else if ((mode === "detail" || mode === "edit") && recordId) {
        targetPath = `${basePath}/${encodeURIComponent(String(recordId))}`;
        if (mode === "edit") targetPath = `${targetPath}/edit`;
      }

      if (targetPath !== locationPathnameRef.current) {
        navigate(targetPath, { replace: true });
      }
    },
    [
      isSheetMode,
      moduleKey,
      navigate,
      routeInfo.collectionPath,
      routeInfo.moduleRoutePath,
    ],
  );

  const handleCreateSuccess = useCallback(() => {
    toast.success("Registro creado correctamente.");
  }, []);

  const handleEditSuccess = useCallback(() => {
    toast.success("Cambios guardados correctamente.");
  }, []);

  const handleDeleteSuccess = useCallback(() => {
    toast.success("Registro eliminado.");
  }, []);

  if (!token) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No hay sesión activa.</CardTitle>
        </CardHeader>
      </Card>
    );
  }

  if (module && !isModuleAvailable(module)) {
    return (
      <div className="p-6">
        <EmptyState
          icon={Package}
          title="Módulo no disponible"
          description="Este módulo no está habilitado en la instancia actual."
        />
      </div>
    );
  }

  if (blueprintsQuery.isLoading) {
    return (
      <div className="flex flex-col min-h-full">
        <div className="flex-1 p-4 md:p-6 space-y-6">
          <div className="flex flex-col gap-4 pb-6 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-8 w-56" />
              <Skeleton className="h-4 w-72" />
            </div>
            <Skeleton className="h-9 w-28 shrink-0 sm:mt-1" />
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Skeleton className="h-9 flex-1 rounded-xl" />
              <Skeleton className="h-9 w-9 rounded-xl" />
              <Skeleton className="h-9 w-24 rounded-xl" />
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="h-8 w-28 rounded-full" />
              <Skeleton className="h-8 w-24 rounded-full" />
              <Skeleton className="ml-auto h-8 w-24 rounded-xl" />
            </div>
          </div>
          <div className="rounded-2xl border border-[hsl(var(--border))] overflow-hidden">
            <div className="bg-[hsl(var(--muted))]/40 px-4 py-3 flex gap-4 border-b border-[hsl(var(--border))]">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton
                  key={i}
                  className={`h-4 ${i === 4 ? "w-8 shrink-0" : "flex-1"}`}
                />
              ))}
            </div>
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="px-4 py-3 border-b border-[hsl(var(--border))] last:border-0 flex gap-4"
              >
                {Array.from({ length: 5 }).map((_, j) => (
                  <Skeleton
                    key={j}
                    className={`h-4 ${j === 4 ? "w-8 shrink-0" : "flex-1"}`}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (blueprintsQuery.isError) {
    return (
      <div className="p-6">
        <ErrorState
          title="No se pudieron cargar las vistas del módulo"
          description="Verifica tu conexión e intenta de nuevo."
          onRetry={() => blueprintsQuery.refetch()}
        />
      </div>
    );
  }

  if (customBlueprint) {
    const componentKey = customBlueprint.schema?.component
    const CustomComponent = componentKey ? componentRegistry.resolve(componentKey) : null

    if (!CustomComponent) {
      return (
        <div className="p-6">
          <Card className="border-amber-400/40 bg-amber-50/60">
            <CardHeader>
              <CardTitle>Componente dinámico no disponible</CardTitle>
              <p className="text-sm text-muted-foreground">
                El componente{' '}
                <code className="font-mono text-xs bg-[hsl(var(--muted))] px-1.5 py-0.5 rounded">
                  {componentKey ?? 'desconocido'}
                </code>{' '}
                no pudo cargarse o registrarse. Reintenta la carga del bundle; si el
                problema continúa, revisa el error específico en la consola.
              </p>
              <div className="pt-2">
                <Button onClick={retryModuleComponents} disabled={isRepairingComponents}>
                  {isRepairingComponents ? "Reintentando..." : "Reintentar componentes"}
                </Button>
              </div>
            </CardHeader>
          </Card>
        </div>
      )
    }

    return (
      <CustomViewHost
        component={CustomComponent}
        moduleKey={moduleKey}
        token={token}
        companyId={activeCompanyId}
        apiBaseUrl={API_BASE_URL}
        navigate={navigate}
        blueprints={moduleRows}
      />
    )
  }

  if (dashboardBlueprint) {
    return <BlueprintRenderer adapters={adapters} kind="DASHBOARD" blueprint={dashboardBlueprint} moduleKey={moduleKey} companyId={activeCompanyId} queryDashboard={async (payload) => {
      const response = await runly.modules.queryDashboard(moduleKey, payload, token)
      return response?.data ?? {}
    }} />
  }

  if (kanbanBlueprint) {
    return <BlueprintRenderer adapters={adapters} kind="KANBAN" blueprint={kanbanBlueprint} moduleKey={moduleKey} companyId={activeCompanyId} queryKanban={async (payload) => {
      const response = await runly.modules.queryKanban(moduleKey, payload, token)
      return response?.data ?? {}
    }} updateRecord={async (apiPath, id, patch) => {
      const response = await runly.modules.updateKanbanRecord(apiPath, id, patch, token)
      return response?.data
    }} onCardClick={kanbanDetailPath ? (id) => navigate(`${kanbanDetailPath}/${id}`) : undefined} />
  }

  if (recordsViewBlueprint) {
    return <RunlyRecordsView
      blueprint={recordsViewBlueprint}
      kind={getBlueprintKind(recordsViewBlueprint)}
      moduleKey={moduleKey}
      companyId={activeCompanyId}
      queryRecordsView={async (payload) => (await runly.modules.queryRecordsView(moduleKey, payload, token))?.data ?? {}}
      resolveImage={(fileId) => fetchSignedUrl(API_BASE_URL, token, fileId, activeCompanyId)}
      onOpen={kanbanDetailPath ? (id) => navigate(`${kanbanDetailPath}/${id}`) : undefined}
    />
  }

  if (groupedTabs?.shouldRedirect && groupedTabs.defaultPath) {
    return null;
  }

  if (!selection.tableBlueprint) {
    const emptyLabel = normalizeSpanishLabel(
      resolveEmptyLabel(routeInfo.entitySegment, navItem),
    );
    return (
      <div className="p-6">
        <EmptyState
          icon={Package}
          title="Vista no encontrada"
          description={
            emptyLabel
              ? `No se encontró una vista para "${emptyLabel}". Verifica que el módulo tenga blueprints configurados.`
              : "Esta ruta no tiene blueprints configurados."
          }
        />
      </div>
    );
  }

  const pageTitle = normalizeSpanishLabel(
    resolvePageTitle(selection.tableBlueprint, navItem),
  );
  const pageDescription = normalizeSpanishLabel(
    resolvePageDescription(selection.tableBlueprint, module, navItem),
  );

  const canCreate =
    Boolean(selection.formBlueprint) && routeInfo.initialMode === "list";
  const createLabel = normalizeSpanishLabel(
    selection.tableBlueprint?.schema?.actions?.[0]?.label ?? "Agregar",
  );
  const createPath = routeInfo.moduleRoutePath
    ? `${routeInfo.moduleRoutePath}/new`
    : null;
  const usesCrudLayout = presentation.layoutKey === "runly.crudLayout";
  const usesDashboardShell = presentation.shellKey === "runly.dashboardShell";
  const unsupportedPresentationKeys = [
    presentation.unsupportedShellKey
      ? `shell "${presentation.unsupportedShellKey}" (${presentation.shellSource})`
      : null,
    presentation.unsupportedLayoutKey
      ? `layout "${presentation.unsupportedLayoutKey}" (${presentation.layoutSource})`
      : null,
  ].filter(Boolean);

  return (
    <div className={usesDashboardShell ? "flex flex-col" : "p-4 md:p-6"}>
      {/* List-mode header: only shown for the main listing view, not form/detail/edit.
          RunlyCrudView renders its own compact header for create/detail/edit modes. */}
      {usesCrudLayout && routeInfo.initialMode === "list" && (
        <div className="p-4 md:p-6 pb-0 space-y-4">
          <PageHeader
            eyebrow={moduleName || undefined}
            title={pageTitle}
            description={pageDescription || undefined}
            className="pb-0"
            actions={
              canCreate ? (
                <Button
                  onClick={() => {
                    if (isSheetMode) {
                      crudViewRef.current?.openCreate();
                    } else if (createPath) {
                      navigate(createPath);
                    }
                  }}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  {createLabel}
                </Button>
              ) : undefined
            }
          />
        </div>
      )}

      {/* Underline tab bar — only when sidebar children do NOT handle navigation */}
      {usesCrudLayout && showTabBar ? (
        <div className="px-4 md:px-6 mt-2 border-b border-[hsl(var(--border))]">
          <div className="flex items-end gap-0 -mb-px">
            {groupedTabs.tabs.map((tab) => {
              const isActive = tab.path === groupedTabs.activePath;
              return (
                <button
                  key={tab.path}
                  type="button"
                  onClick={() => navigate(tab.path)}
                  className={`px-4 py-2.5 text-sm font-medium transition-colors duration-150 border-b-2 whitespace-nowrap cursor-pointer ${
                    isActive
                      ? "text-[hsl(var(--foreground))]"
                      : "border-b-transparent text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                  }`}
                  style={
                    isActive
                      ? { borderBottomColor: module?.color ?? "hsl(var(--primary))" }
                      : {}
                  }
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className={usesCrudLayout ? "p-4 md:p-6 space-y-6 pt-2" : "space-y-6"}>
        {unsupportedPresentationKeys.length > 0 ? (
          <Card className="border-amber-400/40 bg-amber-50/60">
            <CardHeader>
              <CardTitle>Layout de blueprint no soportado</CardTitle>
              <p className="text-sm text-muted-foreground">
                Se detectaron claves de shell/layout no soportadas y se aplico el fallback
                estandar (`runly.dashboardShell` + `runly.crudLayout`).
              </p>
              <div className="space-y-1 text-xs text-muted-foreground">
                {unsupportedPresentationKeys.map((row) => (
                  <p key={row}>{row}</p>
                ))}
              </div>
            </CardHeader>
          </Card>
        ) : null}

        {missingComponentRefs.length > 0 ? (
          <Card className="border-amber-400/40 bg-amber-50/60">
            <CardHeader>
              <CardTitle>
                Componentes din&aacute;micos no disponibles
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Runly no pudo cargar o registrar algunos componentes referenciados por
                los blueprints. Reintenta la carga y revisa la consola si el problema
                contin&uacute;a.
              </p>
              <div className="pt-2">
                <Button onClick={retryModuleComponents} disabled={isRepairingComponents}>
                  {isRepairingComponents ? "Reintentando..." : "Reintentar componentes"}
                </Button>
              </div>
              <div className="space-y-1 text-xs text-muted-foreground">
                {missingComponentRefs.map((entry) => (
                  <p key={entry.componentKey}>
                    <strong>{entry.componentKey}</strong> · vistas:{" "}
                    {entry.blueprintKeys.join(", ")}
                  </p>
                ))}
              </div>
            </CardHeader>
          </Card>
        ) : null}

        <BlueprintRenderer adapters={adapters} kind="TABLE"
          ref={crudViewRef}
          tableBlueprint={selection.tableBlueprint}
          formBlueprint={selection.formBlueprint}
          detailBlueprint={selection.detailBlueprint}
          fields={fields}
          token={token}
          companyId={activeCompanyId}
          apiBaseUrl={API_BASE_URL}
          componentRegistry={componentRegistry}
          module={module}
          suppressToolbarCreate
          initialMode={routeInfo.initialMode}
          recordId={routeInfo.recordId}
          onNavigate={handleNavigate}
          onCreateSuccess={handleCreateSuccess}
          onEditSuccess={handleEditSuccess}
          onDeleteSuccess={handleDeleteSuccess}
          extraDetailActions={extraDetailActions}
        />
        {shareDialog}
      </div>
    </div>
  );
}
