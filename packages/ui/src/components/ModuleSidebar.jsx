import { ChevronLeft, ChevronRight, ChevronDown, X, Download } from "lucide-react";
import { useState, useMemo } from "react";
import { cn } from "../lib/utils.js";
import { Badge } from "./Badge.jsx";
import {
  FleetVehicleIcon,
  resolveModuleIcon,
} from "./module-icon-registry.jsx";

export { FleetVehicleIcon };

function NavIcon({ name, size = 15, ...props }) {
  const Icon = resolveModuleIcon(name);
  return <Icon size={size} {...props} />;
}

function buildFullPath(moduleKey, path) {
  if (!path) return "";
  if (path.startsWith("/app/")) return path;
  return path === "/" ? `/app/m/${moduleKey}` : `/app/m/${moduleKey}${path}`;
}

export function ModuleSidebar({
  module,
  currentPath,
  onNavigate,
  collapsed,
  onCollapse,
  mobileOpen = false,
  onMobileClose,
  canInstall = false,
  onInstall,
  contained = false,
  sidebarSlot = null,
  editionName = "Jaguar",
  navBadges = {},
}) {
  if (!module) return null;

  // uid is a stable unique identifier: fullPath for leaf items, label-based fallback for groups without a path.
  const navItems = (module.navigation ?? []).map((item, index) => {
    const fullPath = buildFullPath(module.key, item.path);
    return {
      ...item,
      fullPath,
      uid: fullPath || `${module.key}:group:${item.label ?? index}`,
      children: (item.children ?? []).map((child) => ({
        ...child,
        fullPath: buildFullPath(module.key, child.path),
      })),
    };
  });

  // Pick only the most specific (longest) nav item / child that matches currentPath
  const activeFullPath = useMemo(() => {
    const allPaths = [];
    for (const item of navItems) {
      allPaths.push({ fullPath: item.fullPath, path: item.path });
      for (const child of item.children ?? []) {
        allPaths.push({ fullPath: child.fullPath, path: child.path });
      }
    }
    return (
      [...allPaths]
        .sort((a, b) => b.fullPath.length - a.fullPath.length)
        .find((item) => {
          if (!item.fullPath) return false;
          return (
            currentPath === item.fullPath ||
            currentPath.startsWith(item.fullPath + "/")
          );
        })?.fullPath ?? null
    );
  }, [navItems, currentPath]);

  // Groups that contain the active path are auto-expanded on mount
  const initialOpenGroups = useMemo(() => {
    const open = new Set();
    for (const item of navItems) {
      if (!item.children?.length) continue;
      const hasActive = item.children.some(
        (child) =>
          currentPath === child.fullPath ||
          currentPath.startsWith(child.fullPath + "/"),
      );
      if (hasActive) open.add(item.uid);
    }
    return open;
  }, []); // intentionally empty deps — only initializes once on mount

  const [openGroups, setOpenGroups] = useState(initialOpenGroups);

  function toggleGroup(uid) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  }

  return (
    <aside
      className={cn(
        "flex flex-col shrink-0 bg-surface-2 border-r border-[hsl(var(--border))] overflow-hidden",
        contained
          ? "h-full w-full"
          : cn(
              // Mobile: fixed overlay drawer. top/height use inline style so this component
              // doesn't depend on the custom CSS classes (top-topbar / h-below-topbar) that
              // are defined in apps/desktop/src/styles.css and may not resolve in all builds.
              "fixed left-0 w-72 z-40",
              // Subtle directional shadow on mobile to separate from content; removed on desktop
              "shadow-[4px_0_20px_rgba(0,0,0,0.10)] lg:shadow-none",
              "transition-transform duration-300 ease-in-out",
              mobileOpen ? "translate-x-0" : "-translate-x-full",
              // Desktop (lg+): static flex child — inline top/height have no layout effect here
              "lg:static lg:z-auto",
              "lg:translate-x-0 lg:transition-[width] lg:duration-300 lg:ease-in-out",
              collapsed ? "lg:w-14" : "lg:w-60",
            ),
      )}
      style={
        contained
          ? undefined
          : {
              top: "calc(var(--topbar-height, 3.5rem) + env(safe-area-inset-top, 0px))",
              height:
                "calc(100dvh - var(--topbar-height, 3.5rem) - env(safe-area-inset-top, 0px))",
            }
      }
    >
      {/* Module header */}
      <div className="flex items-center gap-3 border-b border-[hsl(var(--border))] h-14 px-3 shrink-0">
        <div
          className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0"
          style={{ backgroundColor: `${module.color}20` }}
        >
          {typeof module.logoUrl === "string" && module.logoUrl.trim() ? (
            <span className="h-6 w-6 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))]/85 flex items-center justify-center overflow-hidden shadow-sm">
              <img
                src={module.logoUrl}
                alt=""
                className="h-full w-full object-cover"
              />
            </span>
          ) : (
            <NavIcon
              name={module.icon}
              size={16}
              style={{ color: module.color }}
            />
          )}
        </div>
        <div
          className={cn(
            "min-w-0 flex-1 overflow-hidden transition-[opacity,max-width] duration-300 ease-in-out whitespace-nowrap",
            collapsed ? "max-w-0 opacity-0" : "max-w-full opacity-100",
          )}
        >
          <p className="text-sm font-semibold truncate leading-tight text-[hsl(var(--foreground))]">
            {module.name}
          </p>
          <p className="text-[11px] text-[hsl(var(--muted-foreground))] leading-tight mt-0.5">
            Módulo
          </p>
        </div>
        {/* Install as app button:
            - Regular mode: desktop-only (lg:flex), sits before the close zone
            - Contained/overlay mode: combined into a single button shown always */}
        {canInstall && !collapsed && (
          <button
            className={cn(
              "h-7 w-7 items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors shrink-0 cursor-pointer",
              contained ? "flex" : "hidden lg:flex",
              !contained && "ml-auto",
            )}
            onClick={onInstall}
            title="Instalar como app"
            aria-label="Instalar modulo como app"
          >
            <Download size={13} />
          </button>
        )}
        {/* Close button: mobile-only for regular sidebar; always visible in overlay (contained) mode */}
        <button
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors shrink-0 cursor-pointer",
            !contained && "lg:hidden",
            !canInstall && "ml-auto",
          )}
          onClick={onMobileClose}
          aria-label="Cerrar menu"
        >
          <X size={15} />
        </button>
        {/* Mobile-only install button (regular mode only — contained mode uses the unified button above) */}
        {canInstall && !contained && (
          <button
            className="lg:hidden flex h-7 w-7 items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors shrink-0 cursor-pointer"
            onClick={onInstall}
            title="Instalar como app"
            aria-label="Instalar modulo como app"
          >
            <Download size={13} />
          </button>
        )}
      </div>

      {/* Navigation items */}
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
        {navItems.map((item) => {
          const hasChildren = item.children?.length > 0;

          if (!hasChildren) {
            // Flat nav item (unchanged behavior)
            const isActive = item.fullPath === activeFullPath;
            return (
              <a
                key={item.uid}
                href={item.fullPath}
                onClick={(e) => {
                  if (e.ctrlKey || e.metaKey || e.button === 1) return;
                  e.preventDefault();
                  onNavigate(item.fullPath);
                }}
                title={collapsed ? item.label : undefined}
                className={cn(
                  "w-full flex items-center gap-2.5 px-2.5 h-9 rounded-lg text-sm",
                  "transition-colors duration-150 cursor-pointer outline-none overflow-hidden",
                  "hover:bg-[hsl(var(--muted))]",
                  isActive
                    ? "text-[hsl(var(--foreground))] font-medium"
                    : "text-[hsl(var(--muted-foreground))]",
                )}
                style={
                  isActive
                    ? {
                        borderLeft: `2px solid ${module.color}`,
                        backgroundColor: `${module.color}14`,
                      }
                    : { borderLeft: "2px solid transparent" }
                }
              >
                <NavIcon
                  name={item.icon}
                  size={15}
                  className="shrink-0"
                  style={{ color: isActive ? module.color : undefined }}
                />
                <span
                  className={cn(
                    "truncate whitespace-nowrap overflow-hidden transition-[opacity,max-width] duration-300 ease-in-out",
                    collapsed ? "max-w-0 opacity-0" : "max-w-full opacity-100",
                  )}
                >
                  {item.label}
                </span>
                {navBadges[item.fullPath] > 0 && !collapsed && (
                  <Badge
                    variant="destructive"
                    className="ml-auto shrink-0 h-4 min-w-4 justify-center rounded-full px-1 text-[10px] leading-none"
                  >
                    {navBadges[item.fullPath]}
                  </Badge>
                )}
              </a>
            );
          }

          // Group header with children
          const isOpen = openGroups.has(item.uid);
          const isGroupActive = item.children.some(
            (child) =>
              child.fullPath === activeFullPath ||
              currentPath.startsWith(child.fullPath + "/"),
          );

          return (
            <div key={item.uid}>
              {/* Group header button */}
              <button
                onClick={() => toggleGroup(item.uid)}
                title={collapsed ? item.label : undefined}
                className={cn(
                  "w-full flex items-center gap-2.5 px-2.5 h-9 rounded-lg text-sm",
                  "transition-colors duration-150 cursor-pointer outline-none overflow-hidden",
                  "hover:bg-[hsl(var(--muted))]",
                  isGroupActive && !isOpen
                    ? "text-[hsl(var(--foreground))] font-medium"
                    : "text-[hsl(var(--muted-foreground))]",
                )}
                style={
                  isGroupActive && !isOpen
                    ? {
                        borderLeft: `2px solid ${module.color}`,
                        backgroundColor: `${module.color}14`,
                      }
                    : { borderLeft: "2px solid transparent" }
                }
              >
                <NavIcon
                  name={item.icon}
                  size={15}
                  className="shrink-0"
                  style={{
                    color: isGroupActive && !isOpen ? module.color : undefined,
                  }}
                />
                <span
                  className={cn(
                    "flex-1 truncate whitespace-nowrap overflow-hidden transition-[opacity,max-width] duration-300 ease-in-out text-left",
                    collapsed ? "max-w-0 opacity-0" : "max-w-full opacity-100",
                  )}
                >
                  {item.label}
                </span>
                {/* Chevron — only visible when sidebar is expanded */}
                <ChevronDown
                  size={14}
                  className={cn(
                    "shrink-0 transition-[opacity,transform] duration-200 ease-in-out text-[hsl(var(--muted-foreground))]",
                    collapsed ? "opacity-0 w-0" : "opacity-100",
                    isOpen ? "rotate-180" : "rotate-0",
                  )}
                />
              </button>

              {/* Child items — tree-line style */}
              {isOpen && !collapsed && (
                <div className="mt-0.5 pl-2.5">
                  <div className="border-l border-[hsl(var(--border))] space-y-0.5 pl-2">
                    {item.children.map((child) => {
                      const isChildActive =
                        child.fullPath === activeFullPath ||
                        currentPath.startsWith(child.fullPath + "/");
                      return (
                        <a
                          key={child.fullPath}
                          href={child.fullPath}
                          onClick={(e) => {
                            if (e.ctrlKey || e.metaKey || e.button === 1) return;
                            e.preventDefault();
                            onNavigate(child.fullPath);
                          }}
                          className={cn(
                            "w-full flex items-center gap-2 h-8 rounded-lg text-sm px-2",
                            "transition-colors duration-150 cursor-pointer outline-none overflow-hidden",
                            "hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]",
                            isChildActive
                              ? "text-[hsl(var(--foreground))] font-medium"
                              : "text-[hsl(var(--muted-foreground))]",
                          )}
                          style={
                            isChildActive
                              ? { backgroundColor: `${module.color}12` }
                              : {}
                          }
                        >
                          <span
                            className={cn(
                              "h-1.5 w-1.5 rounded-full shrink-0 transition-colors duration-150",
                              isChildActive ? "opacity-100" : "opacity-40",
                            )}
                            style={{
                              backgroundColor: isChildActive
                                ? module.color
                                : "hsl(var(--muted-foreground))",
                            }}
                          />
                          <span className="truncate">{child.label}</span>
                          {navBadges[child.fullPath] > 0 && (
                            <Badge
                              variant="destructive"
                              className="ml-auto shrink-0 h-4 min-w-4 justify-center rounded-full px-1 text-[10px] leading-none"
                            >
                              {navBadges[child.fullPath]}
                            </Badge>
                          )}
                        </a>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Module-specific sidebar slot (e.g. Notes folder list) — hidden when collapsed */}
      {sidebarSlot && !collapsed && (
        <div className="shrink-0 border-t border-[hsl(var(--border))]">
          {sidebarSlot}
        </div>
      )}

      {/* Bottom bar: brand (mobile) + collapse toggle (desktop) */}
      <div className="shrink-0 border-t border-[hsl(var(--border))] safe-bottom">
        {/* Brand — mobile only; desktop uses BrandFooter */}
        <div className="lg:hidden px-3 pt-3 pb-2 flex flex-col gap-1">
          <p className="text-[10px] text-[hsl(var(--muted-foreground))] leading-none">
            Runly ERP {editionName}{" "}
            <span className="font-medium">v0.1</span>
          </p>
          <a
            href="https://racoondevs.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-[hsl(var(--muted-foreground))] leading-none hover:text-[hsl(var(--foreground))] transition-colors duration-150"
          >
            Hecho con amor por Racoon Devs
          </a>
        </div>
        {/* Collapse toggle — desktop only, not in overlay (contained) mode */}
        <div className={cn("hidden p-2", !contained && "lg:block")}>
          <button
            onClick={onCollapse}
            title={
              collapsed ? "Expandir panel lateral" : "Colapsar panel lateral"
            }
            className={cn(
              "w-full h-8 flex items-center justify-center rounded-lg cursor-pointer",
              "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]",
              "hover:bg-[hsl(var(--muted))] transition-colors duration-150",
            )}
          >
            {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </button>
        </div>
      </div>
    </aside>
  );
}
