import { hasBuiltInModule, isPathAllowedByNavigation, resolveScreen } from './module-screen-resolver.js';
import { lazy, Suspense, useEffect, useMemo } from "react";
import { useParams, useNavigate, useLocation, Navigate } from "react-router-dom";
import { findModuleByKey, resolveModuleAliasPath } from '@runly/core';
import { Badge, Skeleton } from "@runly/ui";
import { Layers } from "lucide-react";
import { BlueprintCrudScreen } from "../shell/BlueprintCrudScreen.jsx";
import { useRuntimeModules } from "./useRuntimeModules";
import { isModuleAvailable } from "../lib/runtimeModules";
import { applyBrandTheme } from "../lib/brandTheme.js";
import { useBrandingStore } from "../stores/branding.js";

const PfmAssistantSidebar = lazy(() =>
  import("../modules/runly.pfm/components/PfmAssistantSidebar.jsx").then((m) => ({
    default: m.PfmAssistantSidebar,
  })),
);

const InventoryAssistantHost = lazy(() => import("../modules/runly.inventory/components/InventoryAssistant.jsx").then(m => ({ default: m.InventoryAssistantHost })));

const SCREEN_MAP = {
  "runly.core:/modules": lazy(
    () => import("../modules/runly.core/screens/ModuleCatalog.jsx"),
  ),
  "runly.core:/settings": lazy(
    () => import("../modules/runly.core/screens/InstanceSettings.jsx"),
  ),
  "runly.core:/settings/smtp": lazy(
    () => import("../modules/runly.core/screens/SmtpSettingsScreen.jsx"),
  ),
  "runly.core:/settings/webpush": lazy(
    () => import("../modules/runly.core/screens/WebPushSettingsScreen.jsx"),
  ),
  "runly.company:/": lazy(
    () => import("../modules/runly.company/screens/CompanyOverview.jsx"),
  ),
  "runly.company:/company": lazy(
    () => import("../modules/runly.company/screens/CompanyProfile.jsx"),
  ),
  "runly.company:/company/address": lazy(
    () => import("../modules/runly.company/screens/CompanyAddress.jsx"),
  ),
  "runly.company:/company/branding": lazy(
    () => import("../modules/runly.company/screens/CompanyBranding.jsx"),
  ),
  "runly.company:/company/members": lazy(
    () => import("../modules/runly.company/screens/CompanyMembers.jsx"),
  ),
  "runly.identity:/identity/users": lazy(
    () => import("../modules/runly.identity/screens/UsersScreen.jsx"),
  ),
  "runly.identity:/identity/users/new": lazy(
    () => import("../modules/runly.identity/screens/UserCreateScreen.jsx"),
  ),
  "runly.identity:/identity/users/:id": lazy(
    () => import("../modules/runly.identity/screens/UserDetailScreen.jsx"),
  ),
  "runly.identity:/identity/users/:id/edit": lazy(
    () => import("../modules/runly.identity/screens/UserEditScreen.jsx"),
  ),
  "runly.identity:/identity/roles": lazy(
    () => import("../modules/runly.identity/screens/RolesScreen.jsx"),
  ),
  "runly.identity:/identity/roles/:id": lazy(
    () => import("../modules/runly.identity/screens/RoleEditorScreen.jsx"),
  ),
  "runly.identity:/identity/chat-reports": lazy(
    () => import("../modules/runly.identity/screens/ChatReportsScreen.jsx"),
  ),
  "runly.contacts:/": lazy(
    () => import("../modules/runly.contacts/screens/ContactsScreen.jsx"),
  ),
  "runly.contacts:/contacts": lazy(
    () => import("../modules/runly.contacts/screens/ContactsScreen.jsx"),
  ),
  "runly.contacts:/contacts/:id": lazy(
    () => import("../modules/runly.contacts/screens/ContactsScreen.jsx"),
  ),
  "runly.files:/": lazy(
    () => import("../modules/runly.files/screens/FilesScreen.jsx"),
  ),
  "runly.files:/files": lazy(
    () => import("../modules/runly.files/screens/FilesScreen.jsx"),
  ),
  "runly.files:/files/:id": lazy(
    () => import("../modules/runly.files/screens/FilesScreen.jsx"),
  ),
  "runly.files:/files/:id/edit": lazy(
    () => import("../modules/runly.files/screens/OfficeEditorScreen.jsx"),
  ),
  "runly.hr:/": lazy(() => import("../modules/runly.hr/screens/HrScreen.jsx")),
  "runly.hr:/hr": lazy(
    () => import("../modules/runly.hr/screens/HrScreen.jsx"),
  ),
  "runly.hr:/hr/employees": lazy(
    () => import("../modules/runly.hr/screens/HrScreen.jsx"),
  ),
  "runly.hr:/hr/employees/:id": lazy(
    () => import("../modules/runly.hr/screens/HrScreen.jsx"),
  ),
  "runly.hr:/hr/org-chart": lazy(
    () => import("../modules/runly.hr/screens/HrScreen.jsx"),
  ),
  "runly.hr:/hr/catalogs": lazy(
    () => import("../modules/runly.hr/screens/HrScreen.jsx"),
  ),
  "runly.identity:/": lazy(
    () => import("../modules/runly.identity/screens/IdentityOverview.jsx"),
  ),
  "runly.ledger:/accounts": lazy(
    () => import("../modules/runly.ledger/screens/AccountsScreen.jsx"),
  ),
  "runly.ledger:/accounts/:id": lazy(
    () => import("../modules/runly.ledger/screens/AccountScreen.jsx"),
  ),
  "runly.ledger:/accounts/:id/import": lazy(
    () => import("../modules/runly.ledger/screens/ImportWizard.jsx"),
  ),
  "runly.ledger:/import-ai": lazy(
    () => import("../modules/runly.ledger/screens/AiImportScreen.jsx"),
  ),
  "runly.ledger:/groups": lazy(
    () => import("../modules/runly.ledger/screens/GroupsScreen.jsx"),
  ),
  "runly.ledger:/groups/:id": lazy(
    () => import("../modules/runly.ledger/screens/GroupScreen.jsx"),
  ),
  "runly.ledger:/memberships": lazy(
    () => import("../modules/runly.ledger/screens/MembershipsScreen.jsx"),
  ),
  "runly.ledger:/categories": lazy(
    () => import("../modules/runly.ledger/screens/CategoriesScreen.jsx"),
  ),
  "runly.ledger:/categories/:id": lazy(
    () => import("../modules/runly.ledger/screens/CategoriesScreen.jsx"),
  ),
  "runly.ledger:/types": lazy(
    () => import("../modules/runly.ledger/screens/TypesScreen.jsx"),
  ),
  "runly.ledger:/types/:id": lazy(
    () => import("../modules/runly.ledger/screens/TypesScreen.jsx"),
  ),
  // runly.pfm screens
  "runly.pfm:/overview": lazy(
    () => import("../modules/runly.pfm/screens/OverviewScreen.jsx"),
  ),
  "runly.pfm:/wallets": lazy(
    () => import("../modules/runly.pfm/screens/WalletsScreen.jsx"),
  ),
  "runly.pfm:/wallets/:id": lazy(
    () => import("../modules/runly.pfm/screens/WalletDetailScreen.jsx"),
  ),
  "runly.pfm:/recurring": lazy(
    () => import("../modules/runly.pfm/screens/RecurringScreen.jsx"),
  ),
  "runly.pfm:/receipts": lazy(
    () => import("../modules/runly.pfm/screens/ReceiptsScreen.jsx"),
  ),
  "runly.pfm:/categories": lazy(
    () => import("../modules/runly.pfm/screens/CategoriesScreen.jsx"),
  ),
  "runly.pfm:/budgets": lazy(
    () => import("../modules/runly.pfm/screens/BudgetsScreen.jsx"),
  ),
  // runly.fleet custom screens
  "runly.fleet:/vehicles": lazy(
    () => import("../modules/runly.fleet/screens/VehiclesScreen.jsx"),
  ),
  "runly.fleet:/vehicles/:id": lazy(
    () => import("../modules/runly.fleet/screens/VehiclesScreen.jsx"),
  ),
  "runly.fleet:/drivers": lazy(
    () => import("../modules/runly.fleet/screens/DriversScreen.jsx"),
  ),
  "runly.fleet:/drivers/:id": lazy(
    () => import("../modules/runly.fleet/screens/DriversScreen.jsx"),
  ),
  "runly.fleet:/insurance": lazy(
    () => import("../modules/runly.fleet/screens/InsuranceScreen.jsx"),
  ),
  "runly.fleet:/insurance/:id": lazy(
    () => import("../modules/runly.fleet/screens/InsuranceScreen.jsx"),
  ),
  "runly.fleet:/reports/:type": lazy(
    () => import("../modules/runly.fleet/screens/ReportsScreen.jsx"),
  ),
  "runly.fleet:/reports/:type/new": lazy(
    () => import("../modules/runly.fleet/screens/ReportFormPage.jsx"),
  ),
  "runly.fleet:/reports/:id": lazy(
    () => import("../modules/runly.fleet/screens/ReportDetailScreen.jsx"),
  ),
  "runly.fleet:/catalogs/:section": lazy(
    () => import("../modules/runly.fleet/screens/CatalogsScreen.jsx"),
  ),
  "runly.website:/": lazy(
    () => import("../modules/runly.website/screens/WebsiteOverviewScreen.jsx"),
  ),
  "runly.website:/pages": lazy(
    () => import("../modules/runly.website/screens/WebsitePagesScreen.jsx"),
  ),
  "runly.website:/templates": lazy(
    () => import("../modules/runly.website/screens/WebsiteTemplatesScreen.jsx"),
  ),
  "runly.website:/templates/:id/detail": lazy(
    () => import("../modules/runly.website/screens/WebsiteTemplateDetailScreen.jsx"),
  ),
  "runly.website:/templates/:id/preview": lazy(
    () => import("../modules/runly.website/screens/TemplatePreviewScreen.jsx"),
  ),
  "runly.website:/pages/:id/editor": lazy(
    () =>
      import("../modules/runly.website/screens/WebsitePageEditorScreen.jsx"),
  ),
  "runly.website:/theme": lazy(
    () => import("../modules/runly.website/screens/WebsiteThemeScreen.jsx"),
  ),
  "runly.website:/menus": lazy(
    () => import("../modules/runly.website/screens/WebsiteMenusScreen.jsx"),
  ),
  "runly.website:/blog": lazy(
    () => import("../modules/runly.website/screens/WebsiteBlogScreen.jsx"),
  ),
  "runly.website:/blog/:id/editor": lazy(
    () =>
      import("../modules/runly.website/screens/WebsiteBlogPostEditorScreen.jsx"),
  ),
  "runly.website:/forms": lazy(
    () => import("../modules/runly.website/screens/WebsiteFormsScreen.jsx"),
  ),
  "runly.website:/settings": lazy(
    () => import("../modules/runly.website/screens/WebsiteSettingsScreen.jsx"),
  ),
  "runly.website:/payments": lazy(
    () => import("../modules/runly.website/screens/WebsitePaymentsScreen.jsx"),
  ),
  "runly.growth:/": lazy(
    () => import("../modules/runly.growth/screens/GrowthAnalyticsScreen.jsx"),
  ),
  "runly.growth:/leads": lazy(
    () => import("../modules/runly.growth/screens/GrowthLeadsScreen.jsx"),
  ),
  "runly.growth:/leads/:id": lazy(
    () => import("../modules/runly.growth/screens/GrowthLeadDetailScreen.jsx"),
  ),
  "runly.documents:/templates": lazy(
    () => import("../modules/runly.documents/screens/DocumentTemplatesScreen.jsx"),
  ),
  "runly.documents:/templates/:id/editor": lazy(
    () => import("../modules/runly.documents/screens/DocumentTemplateEditorScreen.jsx"),
  ),
  "runly.documents:/generated": lazy(
    () => import("../modules/runly.documents/screens/GeneratedDocumentsScreen.jsx"),
  ),
  "runly.calendar:/calendar": lazy(
    () => import("../modules/runly.calendar/screens/CalendarScreen.jsx"),
  ),
  "runly.calendar:/": lazy(
    () => import("../modules/runly.calendar/screens/CalendarScreen.jsx"),
  ),
  // runly.projects
  "runly.projects:/": lazy(
    () => import("../modules/runly.projects/screens/ProjectsScreen.jsx"),
  ),
  // runly.chat
  "runly.chat:/": lazy(
    () => import("../modules/runly.chat/screens/ChatScreen.jsx").then((m) => ({ default: m.ChatScreen })),
  ),
  "runly.chat:/chat/inbox": lazy(
    () => import("../modules/runly.chat/screens/ChatScreen.jsx").then((m) => ({ default: m.ChatScreen })),
  ),
  "runly.chat:/chat/external": lazy(
    () => import("../modules/runly.chat/screens/ExternalInboxScreen.jsx").then((m) => ({ default: m.ExternalInboxScreen })),
  ),
  "runly.chat:/chat/attachment/:id/edit": lazy(
    () => import("../modules/runly.chat/screens/ChatOfficeEditorScreen.jsx"),
  ),
  "runly.chat:/chat/templates": lazy(
    () => import("../modules/runly.chat/screens/ChatTemplatesScreen.jsx").then((m) => ({ default: m.ChatTemplatesScreen })),
  ),
  "runly.catalog:/": lazy(
    () => import("../modules/runly.catalog/screens/CatalogProductsScreen.jsx"),
  ),
  "runly.catalog:/categories": lazy(
    () =>
      import("../modules/runly.catalog/screens/CatalogCategoriesScreen.jsx"),
  ),
  "runly.catalog:/inventory": lazy(
    () => import("../modules/runly.catalog/screens/CatalogInventoryScreen.jsx"),
  ),
  "runly.catalog:/:id": lazy(
    () =>
      import("../modules/runly.catalog/screens/CatalogProductDetailScreen.jsx"),
  ),
  "runly.pos:/": lazy(
    () => import("../modules/runly.pos/screens/PosHomeRedirect.jsx"),
  ),
  "runly.pos:/pos/terminal": lazy(
    () => import("../modules/runly.pos/screens/PosTerminalScreen.jsx"),
  ),
  "runly.pos:/pos/tables": lazy(
    () => import("../modules/runly.pos/screens/PosTablesScreen.jsx"),
  ),
  "runly.pos:/pos/floor-planner": lazy(
    () => import("../modules/runly.pos/screens/PosFloorPlannerScreen.jsx"),
  ),
  "runly.pos:/pos/stations": lazy(
    () => import("../modules/runly.pos/screens/PosStationsScreen.jsx"),
  ),
  "runly.pos:/pos/orders": lazy(
    () => import("../modules/runly.pos/screens/PosOrdersScreen.jsx"),
  ),
  "runly.pos:/pos/sessions": lazy(
    () => import("../modules/runly.pos/screens/PosSessionsScreen.jsx"),
  ),
  "runly.pos:/pos/settings": lazy(
    () => import("../modules/runly.pos/screens/PosSettingsScreen.jsx"),
  ),
  "runly.pos:/pos/caja": lazy(
    () => import("../modules/runly.pos/screens/CajaScreen.jsx"),
  ),
  "runly.pos:/pos/caja/historial": lazy(
    () => import("../modules/runly.pos/screens/PosSessionsScreen.jsx"),
  ),
  "runly.pos:/pos/admin/planos": lazy(
    () => import("../modules/runly.pos/screens/PosFloorPlannerScreen.jsx"),
  ),
  "runly.pos:/pos/comandero": lazy(
    () => import("../modules/runly.pos/screens/ComanderoScreen.jsx"),
  ),
  "runly.pos:/pos/comandero/mesa/:tableId": lazy(
    () => import("../modules/runly.pos/screens/ComandaScreen.jsx"),
  ),
  "runly.pos:/pos/cocina": lazy(
    () => import("../modules/runly.pos/screens/CocinaScreen.jsx"),
  ),
  "runly.pos:/pos/admin": lazy(
    () => import("../modules/runly.pos/screens/PosAdminScreen.jsx"),
  ),
  "runly.activity:/": lazy(
    () => import("../modules/runly.activity/ActivityFeedScreen.jsx"),
  ),
  "runly.notifications:/": lazy(
    () =>
      import(
        "../modules/runly.notifications/NotificationsInboxScreen.jsx"
      ),
  ),
  "runly.notifications:/settings": lazy(
    () =>
      import(
        "../modules/runly.notifications/NotificationSettingsScreen.jsx"
      ),
  ),
  // runly.notes
  "runly.notes:/": lazy(() => import("../modules/runly.notes/NotesScreen.jsx")),
  "runly.notes:/notes": lazy(() => import("../modules/runly.notes/NotesScreen.jsx")),
  "runly.notes:/notes/recent": lazy(() => import("../modules/runly.notes/NotesScreen.jsx")),
  "runly.notes:/notes/shared": lazy(() => import("../modules/runly.notes/NotesScreen.jsx")),
  "runly.notes:/notes/trash": lazy(() => import("../modules/runly.notes/NotesScreen.jsx")),
  // runly.inventory
  "runly.inventory:/": lazy(
    () => import("../modules/runly.inventory/screens/InventoryScreen.jsx"),
  ),
  "runly.inventory:/inventory": lazy(
    () => import("../modules/runly.inventory/screens/InventoryScreen.jsx"),
  ),
  "runly.inventory:/inventory/new": lazy(
    () => import("../modules/runly.inventory/screens/InventoryItemForm.jsx"),
  ),
  "runly.inventory:/inventory/intake": lazy(
    () => import("../modules/runly.inventory/screens/InventoryIntakeScreen.jsx"),
  ),
  "runly.inventory:/inventory/:id": lazy(
    () => import("../modules/runly.inventory/screens/InventoryItemDetail.jsx"),
  ),
  "runly.inventory:/inventory/catalogs": lazy(
    () => import("../modules/runly.inventory/screens/InventoryCatalogsScreen.jsx"),
  ),
  "runly.inventory:/inventory/assignments": lazy(
    () => import("../modules/runly.inventory/screens/InventoryAssignmentsScreen.jsx"),
  ),
};

function LoadingFallback() {
  return (
    <div className="p-6 space-y-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-80" />
      <Skeleton className="h-4 w-64" />
      <div className="grid grid-cols-3 gap-4 mt-8">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28 w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}

function ModulePlaceholder({ module }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60dvh] gap-6 px-6 text-center">
      <div
        className="h-20 w-20 rounded-2xl flex items-center justify-center"
        style={{ backgroundColor: `${module.color}20` }}
      >
        <Layers size={36} style={{ color: module.color }} />
      </div>
      <div className="space-y-2 max-w-sm">
        <h1 className="text-3xl font-semibold text-[hsl(var(--foreground))]">
          {module.name}
        </h1>
        {module.summary && (
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            {module.summary}
          </p>
        )}
        <div className="pt-1">
          <Badge variant="secondary">Módulo en desarrollo</Badge>
        </div>
      </div>
      {module.navigation && module.navigation.length > 0 && (
        <div className="flex flex-wrap gap-2 justify-center">
          {module.navigation.map((nav) => (
            <span
              key={nav.path}
              className="px-3 py-1 rounded-full text-xs border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]"
            >
              {nav.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function unavailableMessage(module) {
  if (!module) return "El módulo no está disponible.";
  if (module.status === "DISABLED") {
    return `El módulo ${module.name} está deshabilitado.`;
  }
  if (module.status === "UNINSTALLED") {
    return `El módulo ${module.name} está desinstalado.`;
  }
  return `El módulo ${module.name} no está disponible.`;
}

export function ModuleOutlet() {
  const { moduleKey: requestedModuleKey, "*": wildcard } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { moduleMap, isLoading, isPending, isError, error } =
    useRuntimeModules();

  const module = findModuleByKey(moduleMap, requestedModuleKey) ?? null;
  const moduleKey = module?.key ?? requestedModuleKey;
  const companyPrimaryColor = useBrandingStore((s) => s.branding?.primaryColor);
  const subPath = useMemo(() => {
    if (!wildcard) return "/";
    return `/${wildcard}`;
  }, [wildcard]);

  useEffect(() => {
    if (isLoading || !module) return;

    const color = module?.color ?? "var(--brand-primary)";
    document.documentElement.style.setProperty("--module-accent", color);

    if (module?.color?.startsWith("#")) {
      applyBrandTheme(module.color);
    }

    return () => {
      document.documentElement.style.removeProperty("--module-accent");
      applyBrandTheme(companyPrimaryColor);
    };
  }, [isLoading, module, companyPrimaryColor]);

  useEffect(() => {
    if (isLoading || !module) return;
    if (isModuleAvailable(module)) return;

    navigate("/app/m/runly.core/modules", {
      replace: true,
      state: { moduleWarning: unavailableMessage(module) },
    });
  }, [isLoading, module, navigate]);

  useEffect(() => {
    if (isLoading || !module) return;
    if (subPath !== "/") return;

    const navigation = module.navigation ?? [];
    if (!navigation.length) return;
    const hasRootNavigation = navigation.some((item) => item?.path === "/");
    if (hasRootNavigation) return;

    const fallbackPath = navigation[0]?.path;
    if (!fallbackPath || fallbackPath === "/") return;

    const targetPath = fallbackPath.startsWith("/app/m/")
      ? fallbackPath
      : `/app/m/${module.key}${fallbackPath}`;
    navigate(targetPath, { replace: true });
  }, [isLoading, module, subPath, navigate]);

  if (isLoading || isPending) return <LoadingFallback />;

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60dvh] gap-4 text-center px-6">
        <p className="text-lg font-semibold text-[hsl(var(--foreground))]">
          No se pudo cargar el módulo
        </p>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          {error instanceof Error && error.message
            ? error.message
            : "Hubo un problema consultando los módulos en runtime."}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="text-sm hover:underline cursor-pointer"
          style={{ color: "var(--brand-primary)" }}
        >
          Reintentar
        </button>
      </div>
    );
  }

  if (!module) {
    if (hasBuiltInModule(SCREEN_MAP, moduleKey)) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[60dvh] gap-4 text-center px-6">
          <p className="text-lg font-semibold text-[hsl(var(--foreground))]">
            Acceso restringido
          </p>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            No tienes permisos para acceder a este módulo.
          </p>
          <button
            type="button"
            onClick={() => navigate("/app/home")}
            className="text-sm hover:underline cursor-pointer"
            style={{ color: "var(--brand-primary)" }}
          >
            Volver al inicio
          </button>
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center justify-center min-h-[60dvh] gap-4 text-center px-6">
        <p className="text-lg font-semibold text-[hsl(var(--foreground))]">
          Módulo no encontrado
        </p>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          El módulo{" "}
          <code className="font-mono text-xs bg-[hsl(var(--muted))] px-1.5 py-0.5 rounded">
            {moduleKey}
          </code>{" "}
          no existe o no está registrado.
        </p>
        <button
          type="button"
          onClick={() => navigate("/app/home")}
          className="text-sm hover:underline cursor-pointer"
          style={{ color: "var(--brand-primary)" }}
        >
          Volver al inicio
        </button>
      </div>
    );
  }

  if (!isModuleAvailable(module)) {
    return null;
  }
  if (!isPathAllowedByNavigation(module, subPath)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60dvh] gap-4 text-center px-6">
        <p className="text-lg font-semibold text-[hsl(var(--foreground))]">
          Acceso restringido
        </p>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          No tienes permisos para abrir esta sección.
        </p>
        <button
          type="button"
          onClick={() => navigate("/app/home")}
          className="text-sm hover:underline cursor-pointer"
          style={{ color: "var(--brand-primary)" }}
        >
          Volver al inicio
        </button>
      </div>
    );
  }

  if (requestedModuleKey !== moduleKey) {
    return <Navigate replace to={`${resolveModuleAliasPath(moduleMap, location.pathname)}${location.search}${location.hash}`} />;
  }

  const Screen = resolveScreen(SCREEN_MAP, moduleKey, subPath, BlueprintCrudScreen);
  const screenNode = (
    <Suspense fallback={<LoadingFallback />}>
      {Screen ? <Screen /> : <ModulePlaceholder module={module} />}
    </Suspense>
  );

  if (moduleKey === "runly.pfm") {
    // h-full (not flex-1): <main> is a plain overflow-y-auto block, not a flex
    // container, so flex-1 here is inert and nothing below gets a resolved
    // height. h-full resolves against <main>'s definite height and lets the
    // screen column and the assistant sidebar own their own scroll regions.
    return (
      <div className="flex h-full min-h-0 overflow-hidden">
        <div className="min-w-0 flex-1 overflow-y-auto">{screenNode}</div>
        <Suspense fallback={null}>
          <PfmAssistantSidebar />
        </Suspense>
      </div>
    );
  }

  if (moduleKey === "runly.inventory") {
    return <Suspense fallback={<LoadingFallback />}><InventoryAssistantHost>{screenNode}</InventoryAssistantHost></Suspense>;
  }
  return screenNode;
}
