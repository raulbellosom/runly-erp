import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useOfflineStore, OFFLINE_MODULES } from "@runly/offline";
import { getModuleLaunchPath, getSortedDisplay } from "../lib/runtimeModules";
import { isModuleOfflineBlocked, resolveMenuAnchor } from "../lib/moduleLauncher";
import { recordRecentModule } from "../lib/recentModules";
import { useAppViewPrefs } from "./useAppViewPrefs";

// Shared launcher behavior for HomeScreen and AppLauncher:
// section building, offline-blocking, context-menu state, favorite toggle, navigation.
export function useModuleLauncher(modules) {
  const navigate = useNavigate();
  const {
    sortMode,
    viewMode,
    favorites,
    favoritesFirst,
    isFavorite,
    toggleFavorite,
  } = useAppViewPrefs();
  const isOnline = useOfflineStore((s) => s.isOnline);
  const [contextMenu, setContextMenu] = useState(null);

  const isOfflineBlocked = useCallback(
    (module) => isModuleOfflineBlocked(isOnline, module, OFFLINE_MODULES),
    [isOnline],
  );

  const sections = useMemo(
    () => getSortedDisplay(modules, { sortMode, favorites, favoritesFirst }),
    [modules, sortMode, favorites, favoritesFirst],
  );

  // input: a mouse/pointer event OR a plain {x,y} object (from long-press).
  const openMenu = useCallback((input, moduleKey) => {
    const anchor = resolveMenuAnchor(input);
    if (!anchor) return;
    setContextMenu({ x: anchor.x, y: anchor.y, moduleKey });
  }, []);

  const closeMenu = useCallback(() => setContextMenu(null), []);

  const launch = useCallback(
    (module, opts = {}) => {
      if (isModuleOfflineBlocked(isOnline, module, OFFLINE_MODULES)) return;
      recordRecentModule(module.key);
      navigate(getModuleLaunchPath(module));
      opts.onDone?.();
    },
    [isOnline, navigate],
  );

  return {
    sections,
    viewMode,
    isOfflineBlocked,
    contextMenu,
    openMenu,
    closeMenu,
    isFavorite,
    toggleFavorite,
    launch,
  };
}
