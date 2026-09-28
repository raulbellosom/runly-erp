// Module Builder — Navegación tab (Etapa 10). Paths and permissions are
// always derived (never typed by hand, per the spec's "no advanced mode by
// default"); this tab picks WHICH views appear in the module menu (entity
// pages, dashboards, kanban boards), their label/icon and their order, next
// to a live preview of the resulting sidebar.
import {
  Button,
  Badge,
  EmptyState,
  IconPickerField,
  TextField,
  SortableList,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@runly/ui";
import { GripVertical, Lock, Menu, MoreHorizontal, PanelsTopLeft, Plus, Tag, Trash2 } from "lucide-react";
import { VIEW_KIND_META } from "./RecordsViewEditors";
import {
  addNavigationItem,
  buildModuleIconOptions,
  navigationItems,
  navigationKind,
  navigationTargets,
  removeNavigationItem,
  resolveLucideIcon,
  setNavigationOrder,
  updateNavigationItem,
} from "../../lib/builderHelpers";

const KIND_META = {
  PAGE: { label: "Página de entidad", icon: PanelsTopLeft },
  ...VIEW_KIND_META,
};

function NavItemRow({ item, index, definition, onChange, moduleIcons, readOnly, dragHandleProps, isDragging }) {
  const kind = KIND_META[navigationKind(definition, item)] ?? KIND_META.PAGE;
  const KindIcon = kind.icon;
  return (
    <div className={`flex gap-2 bg-[hsl(var(--card))] px-2 py-3 sm:px-3 ${isDragging ? "relative z-10 rounded-xl shadow-lg" : ""}`}>
      {readOnly ? <span className="w-6" /> : (
        <button
          type="button"
          className="mt-8 flex h-8 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] active:cursor-grabbing"
          aria-label={`Reordenar ${item.label}`}
          {...dragHandleProps}
        >
          <GripVertical className="h-4 w-4" />
        </button>
      )}
      <div className="min-w-0 flex-1 space-y-2">
        <div className="grid gap-3 sm:grid-cols-[11rem_minmax(0,1fr)]">
          <IconPickerField
            label="Icono"
            value={item.icon}
            disabled={readOnly}
            onChange={(value) => onChange((d) => updateNavigationItem(d, index, { icon: value }))}
            icons={moduleIcons.length ? moduleIcons : undefined}
          />
          <TextField
            label="Etiqueta en el menú"
            icon={Tag}
            value={item.label ?? ""}
            disabled={readOnly}
            onChange={(e) => onChange((d) => updateNavigationItem(d, index, { label: e.target.value }))}
          />
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[hsl(var(--muted-foreground))]">
          <Badge variant="outline" className="gap-1"><KindIcon className="h-3 w-3" />{kind.label}</Badge>
          <span className="min-w-0 truncate font-mono" title={item.path}>{item.path}</span>
          <span className="inline-flex items-center gap-1" title="Permiso necesario para ver esta entrada">
            <Lock className="h-3 w-3" />
            <span className="font-mono">{item.permission}</span>
          </span>
        </div>
      </div>
      {!readOnly && (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="ghost" className="mt-7 shrink-0" aria-label={`Acciones de ${item.label}`}>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem className="text-red-600 focus:text-red-600" onSelect={() => onChange((d) => removeNavigationItem(d, index))}>
              <Trash2 />
              Quitar del menú
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

function SidebarPreview({ definition, items }) {
  const ModuleIcon = resolveLucideIcon(definition.icon) ?? PanelsTopLeft;
  const color = typeof definition.color === "string" && definition.color.startsWith("#") ? definition.color : undefined;
  return (
    <aside className="space-y-2 lg:sticky lg:top-4 lg:self-start">
      <p className="text-xs font-medium text-[hsl(var(--muted-foreground))]">Vista previa del menú</p>
      <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 shadow-sm">
        <div className="flex items-center gap-2.5 border-b border-[hsl(var(--border))] px-1 pb-3">
          <span
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-(--brand-primary) text-white"
            style={color ? { backgroundColor: color } : undefined}
          >
            <ModuleIcon className="h-4 w-4" />
          </span>
          <span className="truncate text-sm font-semibold">{definition.name || "Módulo"}</span>
        </div>
        <ul className="space-y-0.5 pt-2">
          {items.map((item, index) => {
            const Icon = resolveLucideIcon(item.icon) ?? ModuleIcon;
            return (
              <li
                key={item.page ?? index}
                className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm ${index === 0 ? "bg-[hsl(var(--muted))] font-medium" : "text-[hsl(var(--muted-foreground))]"}`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{item.label || "Sin etiqueta"}</span>
              </li>
            );
          })}
          {!items.length && <li className="px-2.5 py-3 text-xs text-[hsl(var(--muted-foreground))]">El módulo no tendrá entradas en el menú.</li>}
        </ul>
      </div>
      <p className="text-xs text-[hsl(var(--muted-foreground))]">Cada usuario solo ve las entradas cuyo permiso tiene asignado.</p>
    </aside>
  );
}

export function NavigationTab({ definition, onChange, capabilities, readOnly }) {
  const items = navigationItems(definition);
  const moduleIcons = buildModuleIconOptions(capabilities?.iconNames);
  const usedPages = new Set(items.map((item) => item.page));
  const candidates = navigationTargets(definition).filter((target) => !usedPages.has(target.page));

  const addMenu = !readOnly && (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" disabled={!candidates.length}>
          <Plus className="h-4 w-4" />
          Añadir al menú
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>Vistas disponibles</DropdownMenuLabel>
        {candidates.map((target) => {
          const meta = KIND_META[target.kind] ?? KIND_META.PAGE;
          const Icon = meta.icon;
          return (
            <DropdownMenuItem key={target.page} onSelect={() => onChange((d) => addNavigationItem(d, target))}>
              <Icon />
              <span className="min-w-0">
                <span className="block truncate">{target.label}</span>
                <span className="block truncate text-xs text-[hsl(var(--muted-foreground))]">{meta.label}</span>
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="grid gap-6 pt-4 lg:grid-cols-[minmax(0,1fr)_17rem]">
      <section className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">Menú del módulo</h2>
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              Elige qué vistas aparecen en el menú lateral y en qué orden. La ruta y el permiso se generan automáticamente.
            </p>
          </div>
          {addMenu}
        </div>
        {!readOnly && !candidates.length && items.length > 0 && (
          <p className="text-xs text-[hsl(var(--muted-foreground))]">
            Todas las vistas ya están en el menú. Crea un dashboard o un tablero Kanban en la pestaña Vistas para añadir más entradas.
          </p>
        )}
        {items.length ? (
          <div className="overflow-hidden rounded-2xl border border-[hsl(var(--border))] divide-y divide-[hsl(var(--border))]">
            <SortableList
              items={items.map((item, index) => ({ id: item.page ?? `nav-${index}`, item, index }))}
              onReorder={(next) => onChange((d) => setNavigationOrder(d, next.map((entry) => entry.item)))}
              renderItem={({ item, index }, { dragHandleProps, isDragging }) => (
                <NavItemRow
                  item={item}
                  index={index}
                  definition={definition}
                  onChange={onChange}
                  moduleIcons={moduleIcons}
                  readOnly={readOnly}
                  dragHandleProps={dragHandleProps}
                  isDragging={isDragging}
                />
              )}
            />
          </div>
        ) : (
          <EmptyState
            icon={Menu}
            title="El menú está vacío"
            description="Añade al menú las páginas de tus entidades, dashboards o tableros."
          />
        )}
      </section>
      <SidebarPreview definition={definition} items={items} />
    </div>
  );
}
