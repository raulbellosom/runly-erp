import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Search, X, Home } from 'lucide-react';
import { useLauncherStore } from '../stores/launcher';
import { getModuleLaunchPath } from '../lib/runtimeModules';
import { useRuntimeModules } from '../app/useRuntimeModules';
import { useModuleLauncher } from '../hooks/useModuleLauncher';
import { AppViewControls } from './AppViewControls';
import { AppContextMenu } from './AppContextMenu';
import { ModuleCardGrid, ModuleListRow } from './ModuleCard';

export function AppLauncher() {
  const { isOpen, closeLauncher, toggleLauncher } = useLauncherStore();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const { availableModules } = useRuntimeModules();
  const {
    sections,
    viewMode,
    isOfflineBlocked,
    contextMenu,
    openMenu,
    closeMenu,
    isFavorite,
    toggleFavorite,
    launch,
  } = useModuleLauncher(availableModules);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return availableModules.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        (m.summary ?? '').toLowerCase().includes(q) ||
        m.key.toLowerCase().includes(q),
    );
  }, [query, availableModules]);

  const displaySections = filtered
    ? [{ label: null, modules: filtered }]
    : sections;

  useEffect(() => {
    function handleKey(e) {
      if (e.key === 'Escape') {
        if (contextMenu) { closeMenu(); return; }
        closeLauncher();
        setQuery('');
      }
      if (e.ctrlKey && e.key === '.') {
        e.preventDefault();
        toggleLauncher();
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [closeLauncher, toggleLauncher, contextMenu, closeMenu]);

  function handleLaunch(module) {
    launch(module, {
      onDone: () => {
        closeLauncher();
        setQuery('');
      },
    });
  }

  function handleGoHome() {
    navigate('/app/home');
    closeLauncher();
    setQuery('');
  }

  return (
    <AnimatePresence>
      {isOpen && (
        // No opacity animation on the wrapper (see .glass-overlay in styles.css).
        <div className="fixed inset-0 z-100 flex items-start justify-center">
          <motion.div
            className="absolute inset-0 overlay-scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={() => { closeLauncher(); setQuery(''); }}
          />

          <motion.div
            className="relative glass-overlay rounded-2xl w-full max-w-2xl mx-4 mt-[10dvh] max-h-[80dvh] flex flex-col overflow-hidden"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          >
            {/* Search header */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-(--glass-border) shrink-0">
              <Search size={15} className="text-[hsl(var(--muted-foreground))] shrink-0" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar aplicación..."
                className="flex-1 bg-transparent text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--foreground))]/45 outline-none"
              />
              <button
                onClick={handleGoHome}
                className="h-7 px-2.5 flex items-center gap-1.5 rounded-lg text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors cursor-pointer text-xs font-medium"
              >
                <Home size={13} />
                Inicio
              </button>
              <button
                onClick={() => { closeLauncher(); setQuery(''); }}
                className="h-7 w-7 flex items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors cursor-pointer"
              >
                <X size={14} />
              </button>
            </div>

            {/* Controls bar (hidden during search) */}
            {!query.trim() && (
              <AppViewControls className="px-4 py-2 border-b border-(--glass-border) shrink-0" />
            )}

            {/* Module list */}
            <div className="overflow-y-auto overscroll-contain touch-pan-y flex-1 px-4 py-4 space-y-5">
              {displaySections.every((s) => s.modules.length === 0) ? (
                <p className="text-sm text-center text-[hsl(var(--muted-foreground))] py-8">
                  {query.trim() ? `Sin resultados para "${query}"` : 'No hay aplicaciones disponibles.'}
                </p>
              ) : (
                displaySections.map((section, si) => (
                  <div key={section.label ?? `section-${si}`}>
                    {section.label && (
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))] mb-3">
                        {section.label}
                      </p>
                    )}
                    {viewMode === 'list' ? (
                      <div className="flex flex-col gap-1.5">
                        {section.modules.map((module) => (
                          <ModuleListRow
                            key={module.key}
                            module={module}
                            surface="glass"
                            href={getModuleLaunchPath(module)}
                            onClick={() => handleLaunch(module)}
                            onContextMenu={(e) => openMenu(e, module.key)}
                            onLongPress={openMenu}
                            onToggleFavorite={toggleFavorite}
                            isFavorite={isFavorite(module.key)}
                            isOfflineBlocked={isOfflineBlocked(module)}
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                        {section.modules.map((module) => (
                          <ModuleCardGrid
                            key={module.key}
                            module={module}
                            surface="glass"
                            href={getModuleLaunchPath(module)}
                            onClick={() => handleLaunch(module)}
                            onContextMenu={(e) => openMenu(e, module.key)}
                            onLongPress={openMenu}
                            onToggleFavorite={toggleFavorite}
                            isFavorite={isFavorite(module.key)}
                            isOfflineBlocked={isOfflineBlocked(module)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </motion.div>

          {contextMenu && (
            <AppContextMenu
              x={contextMenu.x}
              y={contextMenu.y}
              moduleKey={contextMenu.moduleKey}
              onClose={closeMenu}
            />
          )}
        </div>
      )}
    </AnimatePresence>
  );
}
