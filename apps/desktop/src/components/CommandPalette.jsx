import { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import { useQuery } from "@tanstack/react-query";
import { Search, X, WifiOff } from "lucide-react";
import { ModuleNavIcon } from "@runly/ui";
import { useCommandStore } from "../stores/command";
import { useRuntimeModules } from "../app/useRuntimeModules";
import { useOfflineStore, OFFLINE_MODULES } from "@runly/offline";
import { useAuth } from "../auth/AuthProvider";
import { runly } from "../lib/runly";
import { ModuleIcon } from "./ModuleCard";
import { buildCommandItems } from "../lib/commandPalette";

const SEARCH_MIN_LENGTH = 2;
const SEARCH_DEBOUNCE_MS = 200;

export function CommandPalette({ activeModule }) {
  const { isOpen, closeCommand, openCommand } = useCommandStore();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const { availableModules } = useRuntimeModules();
  const isOnline = useOfflineStore((s) => s.isOnline);
  const { session } = useAuth();
  const token = session?.access_token;

  const [debouncedQuery, setDebouncedQuery] = useState("");
  useEffect(() => {
    const trimmed = query.trim();
    const t = setTimeout(() => setDebouncedQuery(trimmed), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  const searchEnabled =
    isOpen &&
    isOnline &&
    Boolean(token) &&
    debouncedQuery.length >= SEARCH_MIN_LENGTH;

  const searchQuery = useQuery({
    queryKey: ["command-search", debouncedQuery],
    queryFn: () => runly.search.global(debouncedQuery, { limit: 5 }, token),
    enabled: searchEnabled,
    staleTime: 15000,
    retry: false,
  });

  const { sections, flat } = useMemo(
    () =>
      buildCommandItems({
        availableModules,
        activeModule,
        query,
        isOnline,
        offlineModuleKeys: OFFLINE_MODULES,
        searchGroups: searchQuery.data?.groups ?? [],
      }),
    [availableModules, activeModule, query, isOnline, searchQuery.data],
  );

  const searching = searchEnabled && searchQuery.isFetching;

  function runItem(item) {
    if (!item || item.blocked) return;
    navigate(item.target);
    closeCommand();
    setQuery("");
  }

  useEffect(() => {
    setSelectedIndex(0);
  }, [flat.length]);

  useEffect(() => {
    function handleKey(e) {
      if (e.ctrlKey && e.key === "k") {
        e.preventDefault();
        if (isOpen) closeCommand();
        else openCommand();
      }
      if (!isOpen) return;
      if (e.key === "Escape") {
        closeCommand();
        setQuery("");
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, flat.length - 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      }
      if (e.key === "Enter" && flat[selectedIndex]) {
        runItem(flat[selectedIndex]);
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen, openCommand, closeCommand, flat, selectedIndex]);

  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector(
      `[data-cmd-idx="${selectedIndex}"]`,
    );
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedIndex]);

  useEffect(() => {
    if (isOpen) {
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
    setQuery("");
    setSelectedIndex(0);
  }, [isOpen]);

  let runningIndex = -1;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-110 flex items-start justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <div
            className="absolute inset-0 command-scrim"
            onClick={() => {
              closeCommand();
              setQuery("");
            }}
          />

          <motion.div
            className="relative glass-command rounded-2xl w-full max-w-xl mx-4 mt-[15dvh] flex flex-col overflow-hidden"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="flex items-center gap-3 px-4 py-3 border-b border-[hsl(var(--border))] shrink-0">
              <Search
                size={15}
                className="text-[hsl(var(--muted-foreground))] shrink-0"
              />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar módulos, acciones, páginas..."
                className="flex-1 bg-transparent text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] outline-none"
              />
              <button
                onClick={() => {
                  closeCommand();
                  setQuery("");
                }}
                className="h-7 w-7 flex items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors cursor-pointer"
              >
                <X size={14} />
              </button>
            </div>

            {searching && (
              <div className="shrink-0 px-4 py-1.5 border-b border-[hsl(var(--border))] text-[11px] text-[hsl(var(--muted-foreground))]">
                Buscando...
              </div>
            )}

            <div ref={listRef} className="overflow-y-auto max-h-[50dvh] p-2">
              {flat.length === 0 ? (
                <p className="text-sm text-center text-[hsl(var(--muted-foreground))] py-8">
                  {searching ? "Buscando..." : "Sin resultados"}
                </p>
              ) : (
                sections.map((section) => (
                  <div key={section.id} className="mb-2">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))] px-3 py-1.5">
                      {section.title}
                    </p>
                    {section.items.map((item) => {
                      runningIndex += 1;
                      const idx = runningIndex;
                      const isSelected = idx === selectedIndex;
                      return (
                        <button
                          key={item.key}
                          data-cmd-idx={idx}
                          onClick={() => runItem(item)}
                          onMouseEnter={() => setSelectedIndex(idx)}
                          className={`w-full flex items-center gap-3 py-2.5 px-3 rounded-lg transition-colors duration-100 text-left ${
                            item.blocked
                              ? "opacity-40 cursor-not-allowed"
                              : `cursor-pointer ${
                                  isSelected
                                    ? "command-item-active"
                                    : "hover:bg-[hsl(var(--foreground)/0.05)]"
                                }`
                          }`}
                        >
                          {item.kind === "module" && !item.blocked ? (
                            <ModuleIcon module={item.module} size="sm" />
                          ) : (
                            <div
                              className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0"
                              style={{
                                backgroundColor: item.color
                                  ? `${item.color}20`
                                  : "hsl(var(--muted))",
                              }}
                            >
                              {item.blocked ? (
                                <WifiOff
                                  size={14}
                                  className="text-[hsl(var(--muted-foreground))]"
                                />
                              ) : (
                                <ModuleNavIcon
                                  name={item.icon}
                                  size={14}
                                  style={{
                                    color:
                                      item.color ||
                                      "hsl(var(--muted-foreground))",
                                  }}
                                />
                              )}
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-[hsl(var(--foreground))] truncate">
                              {item.title}
                            </p>
                            {item.subtitle && (
                              <p className="text-xs text-[hsl(var(--muted-foreground))] truncate">
                                {item.subtitle}
                              </p>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ))
              )}
            </div>

            <div className="shrink-0 px-4 py-2 border-t border-[hsl(var(--border))] flex items-center gap-4 text-[10px] text-[hsl(var(--muted-foreground))]">
              <span>
                <kbd className="font-mono mr-1">Up/Down</kbd>navegar
              </span>
              <span>
                <kbd className="font-mono mr-1">Enter</kbd>seleccionar
              </span>
              <span>
                <kbd className="font-mono mr-1">Esc</kbd>cerrar
              </span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
