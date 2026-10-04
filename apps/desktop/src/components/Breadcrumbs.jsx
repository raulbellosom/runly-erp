import { useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { useRuntimeModules } from "../app/useRuntimeModules";
import { TRASH_SUBPATH } from "../shell/trash/useTrashProviders.js";

const STATIC_LABELS = {
  "/app/profile": "Mi perfil",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function buildCrumbs(pathname, moduleMap) {
  if (pathname === "/app" || pathname === "/app/" || pathname === "/app/home") {
    return [];
  }

  const staticLabel = STATIC_LABELS[pathname];
  if (staticLabel) {
    return [{ label: staticLabel, path: pathname, isLast: true }];
  }

  const m = pathname.match(/^\/app\/m\/([^/]+)(\/(.+))?$/);
  if (!m) return [];

  const moduleKey = m[1];
  const rawSub = m[3];
  const mod = moduleMap.get(moduleKey);
  if (!mod) return [];

  const moduleRoot = `/app/m/${moduleKey}`;

  if (!rawSub) {
    return [{ label: mod.name, path: moduleRoot, color: mod.color, isLast: true }];
  }

  const subPath = `/${rawSub}`;
  const navItems = mod.navigation ?? [];
  const navItem = navItems.find(
    (n) =>
      n.path === subPath ||
      n.path === rawSub ||
      (n.path !== "/" && subPath.startsWith(`${n.path}/`)),
  );

  let subLabel;
  if (navItem) {
    subLabel = subPath === navItem.path ? navItem.label : `${navItem.label} · Detalle`;
  } else if (UUID_RE.test(rawSub)) {
    // UUID sub-path = detail page; use the root nav item label as context
    const rootNav = navItems.find((n) => n.path === "/");
    subLabel = rootNav ? `${rootNav.label} · Detalle` : "Detalle";
  } else if (subPath === TRASH_SUBPATH) {
    subLabel = "Desactivados";
  } else {
    subLabel = rawSub;
  }

  return [
    { label: mod.name, path: moduleRoot, color: mod.color, isLast: false },
    { label: subLabel, path: pathname, isLast: true },
  ];
}

export function Breadcrumbs() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { moduleMap } = useRuntimeModules();

  const crumbs = useMemo(
    () => buildCrumbs(pathname, moduleMap),
    [pathname, moduleMap],
  );

  if (crumbs.length === 0) return null;

  return (
    <nav
      aria-label="Ruta de navegacion"
      className="hidden sm:flex items-center gap-0.5 text-xs min-w-0"
    >
      {crumbs.map((crumb, i) => (
        <span key={crumb.path} className="flex items-center gap-0.5 min-w-0">
          {i > 0 && (
            <ChevronRight
              size={11}
              className="shrink-0 text-[hsl(var(--muted-foreground))] opacity-50"
            />
          )}
          {crumb.isLast ? (
            <span
              className="font-medium text-[hsl(var(--foreground))] truncate max-w-[160px]"
              title={crumb.label}
            >
              {crumb.label}
            </span>
          ) : (
            <a
              href={crumb.path}
              onClick={(e) => {
                if (e.ctrlKey || e.metaKey || e.button === 1) return;
                e.preventDefault();
                navigate(crumb.path);
              }}
              className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors duration-150 truncate max-w-[160px] cursor-pointer"
              title={crumb.label}
            >
              {crumb.label}
            </a>
          )}
        </span>
      ))}
    </nav>
  );
}
