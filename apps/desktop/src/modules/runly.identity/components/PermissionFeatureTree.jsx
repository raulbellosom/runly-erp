import { useEffect, useMemo, useState } from "react";
import { Badge, Card, SearchInput, Switch } from "@runly/ui";
import { ChevronsDownUp, ChevronsUpDown, ChevronDown, ChevronRight } from "lucide-react";

const MODULE_LABELS = {
  core: "Core",
  modules: "Modulos",
  identity: "Identidad",
  roles: "Roles",
  permissions: "Permisos",
  profile: "Perfil",
  files: "Archivos",
  company: "Empresa",
  contacts: "Contactos",
  finance: "Finanzas",
  hr: "Recursos Humanos",
  fleet: "Flota",
  ledger: "Libro de cuentas",
  website: "Sitio web",
  audit: "Bitacora",
  activity: "Actividad",
  notifications: "Notificaciones",
  projects: "Proyectos",
  platform: "Plataforma",
  calendar: "Calendario",
  catalog: "Catalogo",
  chat: "Chat",
  pfm: "Finanzas personales",
  inventory: "Inventario",
  pos: "Punto de venta",
  notes: "Notas",
  growth: "Growth",
  documents: "Documentos",
};

const FEATURE_LABELS = {
  general: "General",
  modules: "Modulos",
  instance: "Configuracion",
  users: "Usuarios",
  roles: "Roles",
  permissions: "Permisos",
  self: "Perfil propio",
  profile: "Perfil",
  avatar: "Avatar",
  password: "Contrasena",
  assets: "Archivos",
  contacts: "Contactos",
  ar: "CxC",
  ap: "CxP",
  accounts: "Cuentas",
  entries: "Polizas",
  applications: "Aplicaciones",
  tax_rates: "Impuestos",
  fx_rates: "Tipo de cambio",
  dashboard: "Resumen",
  aging: "Aging",
  documents: "Documentos",
  employee: "Colaboradores",
  department: "Departamentos",
  job_title: "Puestos",
  org_chart: "Organigrama",
  address: "Direccion",
  branding: "Marca visual",
  // fleet
  vehicles: "Vehiculos",
  drivers: "Choferes",
  reports: "Reportes",
  catalogs: "Catalogos",
  insurance: "Seguros",
  // ledger
  categories: "Categorias",
  types: "Tipos",
  // website
  site: "Sitio",
  pages: "Paginas",
  theme: "Tema",
  menus: "Menus",
  // chat
  mirai: "MirAI",
  conversations: "Conversaciones",
  support: "Soporte externo",
  chat_reports: "Reportes de chat",
};

const ACTION_LABELS = {
  read: "Ver",
  create: "Crear",
  update: "Editar",
  delete: "Eliminar",
  access: "Acceder",
  install: "Instalar",
  uninstall: "Desinstalar",
  disable: "Deshabilitar",
  manage: "Administrar",
  reverse: "Revertir",
  send: "Enviar",
  publish: "Publicar",
  export: "Exportar",
  import: "Importar",
  use: "Usar",
};

function parsePermissionKey(key) {
  const parts = String(key ?? "")
    .split(".")
    .filter(Boolean);
  if (parts.length >= 3) {
    return {
      moduleKey: parts[0],
      featureKey: parts.slice(1, -1).join("."),
      actionKey: parts.at(-1),
    };
  }
  if (parts.length === 2) {
    return { moduleKey: parts[0], featureKey: "general", actionKey: parts[1] };
  }
  if (parts.length === 1) {
    return { moduleKey: "general", featureKey: "general", actionKey: parts[0] };
  }
  return { moduleKey: "general", featureKey: "general", actionKey: "sin-clave" };
}

function formatSegmentLabel(value) {
  if (!value || value === "general") return "General";
  return value
    .split(/[._-]/g)
    .filter(Boolean)
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(" ");
}

function getModuleLabel(key) {
  return MODULE_LABELS[key] ?? formatSegmentLabel(key);
}
function getFeatureLabel(key) {
  return FEATURE_LABELS[key] ?? formatSegmentLabel(key);
}
function getActionLabel(key) {
  return ACTION_LABELS[key] ?? formatSegmentLabel(key);
}

// ── Styled Switch with visible active color ────────────────────────────────────
// Use important modifier to override the base indigo-500 from the component

function PermSwitch({ checked, disabled, onCheckedChange, size = "sm" }) {
  return (
    <Switch
      checked={checked}
      disabled={disabled}
      onCheckedChange={onCheckedChange}
      className={
        size === "lg"
          ? "h-6 w-11 data-[state=checked]:bg-emerald-500! shrink-0"
          : "data-[state=checked]:bg-emerald-500! shrink-0"
      }
    />
  );
}

// ── Bulk toggle with always-visible state badge ────────────────────────────────

function BulkSwitch({ selectedCount, totalCount, disabled, onToggle }) {
  const allChecked = totalCount > 0 && selectedCount === totalCount;
  const partial = selectedCount > 0 && selectedCount < totalCount;

  return (
    <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
      {allChecked ? (
        <Badge variant="success" className="text-[10px] uppercase tracking-wide">
          Todos
        </Badge>
      ) : partial ? (
        <Badge variant="secondary" className="text-[10px] tabular-nums">
          {selectedCount}/{totalCount}
        </Badge>
      ) : (
        totalCount > 0 && (
          <Badge
            variant="outline"
            className="text-[10px] uppercase tracking-wide text-[hsl(var(--muted-foreground))] dark:text-slate-400"
          >
            Ninguno
          </Badge>
        )
      )}
      <PermSwitch
        checked={allChecked}
        disabled={disabled}
        onCheckedChange={(checked) => onToggle(checked)}
        size="sm"
      />
    </div>
  );
}

// ── Individual permission row ──────────────────────────────────────────────────

function PermissionRow({ checked, disabled, locked, label, description, onChange }) {
  return (
    <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-[hsl(var(--border))]/60 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-tight flex items-center gap-2">
          {label}
          {locked && (
            <Badge
              variant="secondary"
              className="text-[10px] uppercase tracking-wide dark:bg-white/10 dark:text-slate-200 dark:border-white/15"
            >
              Del rol
            </Badge>
          )}
        </p>
        {description && (
          <p className="text-[11px] text-[hsl(var(--muted-foreground))] dark:text-slate-400 mt-0.5 leading-relaxed">
            {description}
          </p>
        )}
      </div>
      <PermSwitch
        checked={checked}
        disabled={disabled || locked}
        onCheckedChange={() => onChange()}
        size="sm"
      />
    </div>
  );
}

// ── Filter pill group ──────────────────────────────────────────────────────────

const FILTERS = [
  { value: "all", label: "Todos" },
  { value: "assigned", label: "Asignados" },
  { value: "unassigned", label: "Sin asignar" },
];

function FilterPills({ value, onChange }) {
  return (
    <div className="flex items-center rounded-xl border border-[hsl(var(--border))] overflow-hidden text-xs font-medium shrink-0">
      {FILTERS.map((f) => (
        <button
          key={f.value}
          type="button"
          onClick={() => onChange(f.value)}
          className={[
            "px-3 py-2 transition-colors whitespace-nowrap",
            value === f.value
              ? "bg-[--brand-primary] text-[--brand-primary-foreground]"
              : "hover:bg-[hsl(var(--muted))]/60 text-[hsl(var(--muted-foreground))]",
          ].join(" ")}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}

// ── Main tree ──────────────────────────────────────────────────────────────────

export default function PermissionFeatureTree({
  allPermissions,
  pendingKeys,
  baselineKeys,
  onTogglePermission,
  onBulkToggle,
  disabled,
  // Keys the subject already has from another source (e.g. their role) — shown
  // checked + disabled with a "Del rol" badge, and excluded from bulk toggles.
  lockedKeys,
}) {
  const locked = useMemo(() => lockedKeys ?? new Set(), [lockedKeys]);
  // The assigned/unassigned filter runs against the persisted assignment
  // (baselineKeys), not the live pending edits — otherwise a row jumps out of
  // the list the instant you toggle it and you can't confirm the change.
  const filterKeys = baselineKeys ?? pendingKeys;
  const collator = useMemo(
    () => new Intl.Collator("es", { sensitivity: "base", numeric: true }),
    [],
  );

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  // Tracks which modules the user has manually opened (default: derived from assignments)
  const [openedModules, setOpenedModules] = useState(new Set());
  // While a search/filter is active every matching module is open by default;
  // this set records the ones the user explicitly collapsed in that mode.
  const [filterCollapsed, setFilterCollapsed] = useState(new Set());
  const [initialized, setInitialized] = useState(false);

  const filtering = Boolean(search.trim()) || filter !== "all";

  // Leaving filter mode clears the per-filter collapse overrides.
  useEffect(() => {
    if (!filtering && filterCollapsed.size > 0) setFilterCollapsed(new Set());
  }, [filtering, filterCollapsed.size]);

  // Build full module tree from all permissions
  const modules = useMemo(() => {
    const moduleMap = new Map();

    for (const permission of allPermissions) {
      if (!permission?.key) continue;
      const parsed = parsePermissionKey(permission.key);

      if (!moduleMap.has(parsed.moduleKey)) {
        moduleMap.set(parsed.moduleKey, {
          key: parsed.moduleKey,
          label: getModuleLabel(parsed.moduleKey),
          features: new Map(),
        });
      }

      const moduleItem = moduleMap.get(parsed.moduleKey);
      if (!moduleItem.features.has(parsed.featureKey)) {
        moduleItem.features.set(parsed.featureKey, {
          key: parsed.featureKey,
          label: getFeatureLabel(parsed.featureKey),
          items: [],
        });
      }

      moduleItem.features.get(parsed.featureKey).items.push({
        ...permission,
        actionKey: parsed.actionKey,
      });
    }

    return [...moduleMap.values()]
      .map((mod) => ({
        ...mod,
        features: [...mod.features.values()]
          .map((feat) => ({
            ...feat,
            items: [...feat.items].sort((a, b) => {
              const diff = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
              return diff !== 0 ? diff : collator.compare(a.key, b.key);
            }),
          }))
          .sort((a, b) => collator.compare(a.label, b.label)),
      }))
      .sort((a, b) => collator.compare(a.label, b.label));
  }, [allPermissions, collator]);

  // Initialize opened modules: expand those that have at least one assigned permission
  useEffect(() => {
    if (initialized || !pendingKeys || modules.length === 0) return;
    const open = new Set();
    for (const mod of modules) {
      const keys = mod.features.flatMap((f) => f.items.map((i) => i.key));
      if (keys.some((k) => pendingKeys.has(k) || locked.has(k))) open.add(mod.key);
    }
    setOpenedModules(open);
    setInitialized(true);
  }, [initialized, pendingKeys, modules]);

  // Flat list of all module keys for selection stats
  const allModuleKeys = useMemo(
    () =>
      modules.reduce((acc, mod) => {
        mod.features.forEach((f) => f.items.forEach((i) => acc.push(i.key)));
        return acc;
      }, []),
    [modules],
  );

  // Filtered module tree based on search + filter
  const filteredModules = useMemo(() => {
    const q = search.trim().toLowerCase();

    return modules
      .map((mod) => ({
        ...mod,
        features: mod.features
          .map((feat) => ({
            ...feat,
            items: feat.items.filter((item) => {
              if (q) {
                const label = getActionLabel(item.actionKey).toLowerCase();
                const desc = (item.description || item.name || item.key).toLowerCase();
                if (
                  !label.includes(q) &&
                  !desc.includes(q) &&
                  !item.key.toLowerCase().includes(q)
                )
                  return false;
              }
              if (filter === "assigned") return filterKeys.has(item.key);
              if (filter === "unassigned") return !filterKeys.has(item.key);
              return true;
            }),
          }))
          .filter((feat) => feat.items.length > 0),
      }))
      .filter((mod) => mod.features.length > 0);
  }, [modules, search, filter, filterKeys]);

  function isModuleOpen(moduleKey, hasFilteredContent) {
    // While filtering, matching modules are open by default so results are
    // visible — but an explicit collapse still wins.
    if (filtering && hasFilteredContent) return !filterCollapsed.has(moduleKey);
    return openedModules.has(moduleKey);
  }

  function toggleModule(key) {
    if (filtering) {
      setFilterCollapsed((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
      return;
    }
    setOpenedModules((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function expandAll() {
    setOpenedModules(new Set(modules.map((m) => m.key)));
    setFilterCollapsed(new Set());
  }

  function collapseAll() {
    setOpenedModules(new Set());
    // In filter mode, collapse every currently-matching module.
    if (filtering) {
      setFilterCollapsed(new Set(filteredModules.map((m) => m.key)));
    }
  }

  const totalPerms = allModuleKeys.length;
  const totalAssigned = allModuleKeys.filter(
    (k) => pendingKeys.has(k) || locked.has(k),
  ).length;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onClear={() => setSearch("")}
          placeholder="Buscar permiso..."
          className="flex-1 min-w-0 sm:max-w-xs"
        />
        <FilterPills value={filter} onChange={setFilter} />
        <div className="flex items-center rounded-xl border border-[hsl(var(--border))] overflow-hidden text-xs font-medium shrink-0">
          <button
            type="button"
            onClick={expandAll}
            title="Expandir todo"
            className="flex items-center gap-1.5 px-3 py-2 hover:bg-[hsl(var(--muted))]/60 text-[hsl(var(--muted-foreground))] transition-colors whitespace-nowrap"
          >
            <ChevronsUpDown className="h-3.5 w-3.5" />
            Expandir todo
          </button>
          <div className="w-px h-4 bg-[hsl(var(--border))]" />
          <button
            type="button"
            onClick={collapseAll}
            title="Colapsar todo"
            className="flex items-center gap-1.5 px-3 py-2 hover:bg-[hsl(var(--muted))]/60 text-[hsl(var(--muted-foreground))] transition-colors whitespace-nowrap"
          >
            <ChevronsDownUp className="h-3.5 w-3.5" />
            Colapsar todo
          </button>
        </div>
      </div>

      {/* Summary bar */}
      <div className="flex items-center justify-between text-xs text-[hsl(var(--muted-foreground))] dark:text-slate-400">
        <span>
          <span className="tabular-nums font-semibold text-[hsl(var(--foreground))]">
            {totalAssigned}
          </span>{" "}
          de{" "}
          <span className="tabular-nums font-semibold text-[hsl(var(--foreground))]">
            {totalPerms}
          </span>{" "}
          permisos asignados
        </span>
        {(search || filter !== "all") && (
          <button
            type="button"
            onClick={() => {
              setSearch("");
              setFilter("all");
            }}
            className="hover:underline cursor-pointer text-[--brand-primary]"
          >
            Limpiar filtros
          </button>
        )}
      </div>

      {/* Empty state */}
      {filteredModules.length === 0 && (
        <div className="rounded-2xl border border-[hsl(var(--border))] px-4 py-10 text-center">
          <p className="text-sm font-medium text-[hsl(var(--foreground))]">
            Sin resultados
          </p>
          <p className="text-xs text-[hsl(var(--muted-foreground))] dark:text-slate-400 mt-1">
            No hay permisos que coincidan con los filtros aplicados.
          </p>
        </div>
      )}

      {/* Module cards */}
      {filteredModules.map((moduleItem) => {
        // Use original (non-filtered) keys for bulk toggle actions
        const originalModule = modules.find((m) => m.key === moduleItem.key);
        const allModKeys =
          originalModule?.features.flatMap((f) => f.items.map((i) => i.key)) ?? [];
        // Locked (role) keys can't be toggled — keep them out of bulk actions
        // but still count them as "assigned" in the header summary.
        const bulkModKeys = allModKeys.filter((k) => !locked.has(k));
        const moduleSelected = allModKeys.filter(
          (k) => pendingKeys.has(k) || locked.has(k),
        ).length;
        const moduleFull = allModKeys.length > 0 && moduleSelected === allModKeys.length;
        const moduleEmpty = moduleSelected === 0;
        const isOpen = isModuleOpen(moduleItem.key, moduleItem.features.length > 0);

        return (
          <Card
            key={moduleItem.key}
            variant="bordered"
            className={[
              "p-0 overflow-hidden",
              moduleFull ? "ring-1 ring-emerald-500/40" : "",
            ].join(" ")}
          >
            {/* Collapsible module header — split into a button + sibling switch to avoid button-in-button.
                Deliberately NOT green-tinted when moduleFull: the card's emerald ring plus the "Todos"
                badge already signal "fully assigned" — stacking a translucent green header background
                on top of those made the header text hard to read (green-on-green) in dark mode.
                Uses a plain tint here (not the .glass-subtle backdrop-filter class) — this tree already
                sits inside a blurred RunlyDetail section, and this card is now a plain border (no blur
                of its own, see the "bordered" variant above), so a nested blur on top of that too was
                unnecessary and contributed to occasional GPU-compositing flicker on this much stacked
                translucency. */}
            <div className="w-full px-4 py-3 border-b border-[hsl(var(--border))] flex items-center gap-3 transition-colors bg-[hsl(var(--muted))]/40 hover:bg-[hsl(var(--muted))]/55">
              <button
                type="button"
                onClick={() => toggleModule(moduleItem.key)}
                className="flex items-center gap-3 flex-1 text-left min-w-0"
              >
                {isOpen ? (
                  <ChevronDown className="h-4 w-4 shrink-0 text-[hsl(var(--foreground))]/70" />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0 text-[hsl(var(--foreground))]/70" />
                )}

                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold uppercase tracking-[0.15em] text-[hsl(var(--foreground))]">
                    {moduleItem.label}
                  </p>
                  <p
                    className={[
                      "text-[11px] mt-0.5",
                      moduleFull
                        ? "text-emerald-600 dark:text-emerald-400 font-medium"
                        : "text-[hsl(var(--muted-foreground))] dark:text-slate-400",
                    ].join(" ")}
                  >
                    {moduleFull
                      ? "Todos los permisos asignados"
                      : moduleEmpty
                        ? "Sin permisos asignados"
                        : `${moduleSelected} de ${allModKeys.length} permisos asignados`}
                  </p>
                </div>
              </button>

              {/* Bulk switch lives outside the collapse button to avoid nested buttons */}
              <BulkSwitch
                selectedCount={moduleSelected}
                totalCount={allModKeys.length}
                disabled={disabled || bulkModKeys.length === 0}
                onToggle={(checked) => onBulkToggle(bulkModKeys, checked)}
              />
            </div>

            {/* Feature groups (visible when open) */}
            {isOpen && (
              <div>
                {moduleItem.features.map((featureItem) => {
                  const originalFeature = originalModule?.features.find(
                    (f) => f.key === featureItem.key,
                  );
                  const allFeatKeys =
                    originalFeature?.items.map((i) => i.key) ??
                    featureItem.items.map((i) => i.key);
                  const bulkFeatKeys = allFeatKeys.filter((k) => !locked.has(k));
                  const featureSelected = allFeatKeys.filter(
                    (k) => pendingKeys.has(k) || locked.has(k),
                  ).length;

                  return (
                    <div
                      key={`${moduleItem.key}.${featureItem.key}`}
                      className="border-b border-[hsl(var(--border))] last:border-b-0"
                    >
                      {/* Feature header — no background tint of its own: one more nested "box"
                          didn't add clarity here, just visual noise. The bottom border plus the
                          bold uppercase label already separate it from the permission rows below. */}
                      <div className="px-4 py-2.5 border-b border-[hsl(var(--border))]/60 flex items-center justify-between gap-3">
                        <p className="text-xs font-semibold text-[hsl(var(--muted-foreground))] dark:text-slate-300 uppercase tracking-wide">
                          {featureItem.label}
                        </p>
                        <BulkSwitch
                          selectedCount={featureSelected}
                          totalCount={allFeatKeys.length}
                          disabled={disabled || bulkFeatKeys.length === 0}
                          onToggle={(checked) =>
                            onBulkToggle(bulkFeatKeys, checked)
                          }
                        />
                      </div>

                      {/* Permission rows — 2 cols on md+ */}
                      <div className="grid grid-cols-1 md:grid-cols-2">
                        {featureItem.items.map((item) => {
                          const isLocked = locked.has(item.key);
                          return (
                            <PermissionRow
                              key={item.key}
                              checked={isLocked || pendingKeys.has(item.key)}
                              disabled={disabled}
                              locked={isLocked}
                              label={getActionLabel(item.actionKey)}
                              description={
                                item.description || item.name || item.key
                              }
                              onChange={() => onTogglePermission(item.key)}
                            />
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
