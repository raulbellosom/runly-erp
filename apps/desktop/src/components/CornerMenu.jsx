import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import { Home, NotebookPen, Search } from "lucide-react";
import { cn, useKeyboardInset } from "@runly/ui";
import { useRuntimeModules } from "../app/useRuntimeModules";
import { useModuleLauncher } from "../hooks/useModuleLauncher";
import { useAppViewPrefs } from "../hooks/useAppViewPrefs";
import { useCommandStore } from "../stores/command";
import { useQuickNoteStore } from "../modules/runly.notes/quick/quickNoteStore";
import { readRecentModuleKeys } from "../lib/recentModules";
import {
  CORNER_RINGS,
  buildFavoriteSlots,
  itemOffset,
  pickCornerItem,
} from "../lib/cornerMenu";
import { ModuleIcon } from "./ModuleCard";

// Below modals (50), above the quick-notes pad (48) and the call room (46).
const Z_CORNER = 49;
const TOUCH_QUERY = "(hover: none) and (pointer: coarse)";
const TAP_MAX_MOVE = 10;

function useIsTouchDevice() {
  const [touch, setTouch] = useState(
    () => typeof window !== "undefined" && window.matchMedia?.(TOUCH_QUERY).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia?.(TOUCH_QUERY);
    if (!mq) return undefined;
    const onChange = () => setTouch(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return touch;
}

function vibrate(ms) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    // Not supported (iOS): no haptics.
  }
}

function MenuItem({ item, pos, active, delay, onSelect }) {
  return (
    <motion.button
      type="button"
      aria-label={item.label}
      onClick={onSelect}
      initial={{ x: 0, y: 0, scale: 0.3, opacity: 0 }}
      animate={{ x: pos.x, y: pos.y, scale: active ? 1.18 : 1, opacity: 1 }}
      exit={{ x: 0, y: 0, scale: 0.3, opacity: 0, transition: { duration: 0.12 } }}
      transition={{ type: "spring", stiffness: 520, damping: 32, delay }}
      className="absolute -ml-6 -mt-6 h-12 w-12 cursor-pointer"
    >
      <span
        className={cn(
          "flex h-12 w-12 shrink-0 items-center justify-center rounded-full shadow-lg transition-shadow",
          item.module ? "bg-transparent" : "bg-[hsl(var(--card))] text-[hsl(var(--foreground))]",
          active ? "ring-[3px] ring-white shadow-2xl" : "ring-1 ring-white/30",
        )}
      >
        {item.module ? (
          <ModuleIcon module={item.module} size="md" />
        ) : (
          <item.icon size={20} aria-hidden />
        )}
      </span>
    </motion.button>
  );
}

// Mobile corner menu: pull the grip in the bottom-left corner outward and an
// arc of options fans out. Inner ring = quick actions, outer ring = favorite
// (then recent) apps. Release over an option runs it; a plain tap opens the
// menu so options can be tapped instead.
export function CornerMenu() {
  const isTouch = useIsTouchDevice();
  // Hidden while the on-screen keyboard is open (not merely on focus: some
  // screens autofocus a field without raising the keyboard).
  const editing = useKeyboardInset() > 0;
  const navigate = useNavigate();
  const { availableModules } = useRuntimeModules();
  const { launch, isOfflineBlocked } = useModuleLauncher(availableModules);
  const { favorites } = useAppViewPrefs();
  const gripRef = useRef(null);
  const gestureRef = useRef(null);
  const [menu, setMenu] = useState(null); // { origin, mode: 'drag' | 'tap' }
  const [selection, setSelection] = useState(null);
  const [finger, setFinger] = useState(null);

  const hasNotes = availableModules.some((m) => m.key === "runly.notes");
  const rings = useMemo(() => {
    const actions = [
      hasNotes && {
        id: "quick-note",
        label: "Nota rápida",
        icon: NotebookPen,
        run: () => useQuickNoteStore.getState().open(),
      },
      { id: "search", label: "Buscar", icon: Search, run: () => useCommandStore.getState().openCommand() },
      { id: "home", label: "Inicio", icon: Home, run: () => navigate("/app/home") },
    ].filter(Boolean);
    const apps = buildFavoriteSlots(availableModules, favorites, menu ? readRecentModuleKeys() : [])
      .filter((m) => !isOfflineBlocked(m))
      .map((m) => ({ id: m.key, label: m.name, module: m, run: () => launch(m) }));
    return [actions.slice(0, CORNER_RINGS[0].max), apps];
  }, [hasNotes, availableModules, favorites, menu, isOfflineBlocked, launch, navigate]);
  const counts = [rings[0].length, rings[1].length];

  function close() {
    setMenu(null);
    setSelection(null);
    setFinger(null);
    gestureRef.current = null;
  }

  function run(item) {
    close();
    vibrate(15);
    item.run();
  }

  function onPointerDown(e) {
    const rect = gripRef.current.getBoundingClientRect();
    // Origin sits a little inside the corner so labels of the first/last
    // items (nearly vertical / horizontal) never fall off the screen edge.
    const origin = { x: rect.left + 30, y: rect.bottom - 44 };
    gestureRef.current = { start: { x: e.clientX, y: e.clientY }, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
    setMenu({ origin, mode: "drag" });
    setFinger({ x: e.clientX, y: e.clientY });
    vibrate(8);
  }

  function onPointerMove(e) {
    const g = gestureRef.current;
    if (!g || !menu) return;
    if (Math.hypot(e.clientX - g.start.x, e.clientY - g.start.y) > TAP_MAX_MOVE) g.moved = true;
    setFinger({ x: e.clientX, y: e.clientY });
    const next = pickCornerItem(e.clientX - menu.origin.x, e.clientY - menu.origin.y, counts);
    setSelection((prev) => {
      if (next && (prev?.ring !== next.ring || prev?.index !== next.index)) vibrate(6);
      return next;
    });
  }

  function onPointerUp() {
    const g = gestureRef.current;
    gestureRef.current = null;
    if (!g || !menu) return;
    if (!g.moved) {
      // A tap: keep the menu open so options can be tapped.
      setMenu((m) => (m ? { ...m, mode: "tap" } : m));
      setSelection(null);
      setFinger(null);
      return;
    }
    const item = selection ? rings[selection.ring][selection.index] : null;
    if (item) run(item);
    else close();
  }

  // Back button / Escape closes an open tap-mode menu.
  useEffect(() => {
    if (!menu) return undefined;
    const onKey = (e) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

  if (!isTouch) return null;

  const selected = selection ? rings[selection.ring][selection.index] : null;
  const caption = selected?.label ?? (menu?.mode === "tap" ? "Toca una opción" : "Desliza hacia una opción y suelta");

  return createPortal(
    <>
      {/* Stays mounted while the menu is open: it owns the pointer capture
          for the whole drag gesture. */}
      {!editing && (
        <button
          ref={gripRef}
          type="button"
          aria-label="Menú rápido: nota rápida, búsqueda y favoritos"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={close}
          className={cn(
            "fixed bottom-0 left-0 flex h-14 w-14 touch-none select-none items-end justify-start",
            menu && "opacity-0",
          )}
          style={{
            zIndex: Z_CORNER,
            paddingLeft: "max(6px, env(safe-area-inset-left))",
            paddingBottom: "max(6px, env(safe-area-inset-bottom))",
          }}
        >
          <span
            aria-hidden
            className="block h-7 w-7 rounded-tr-full border-r-2 border-t-2 border-(--brand-primary)/70 bg-(--brand-primary)/15 shadow-sm backdrop-blur-sm"
          />
        </button>
      )}

      <AnimatePresence>
        {menu && (
          <motion.div
            key="corner-menu"
            className="fixed inset-0 touch-none select-none"
            style={{ zIndex: Z_CORNER }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.12 } }}
          >
            <button
              type="button"
              aria-label="Cerrar menú rápido"
              onClick={close}
              className="absolute inset-0 cursor-default bg-black/45 backdrop-blur-[2px]"
            />
            {/* Corner glow + ring guides */}
            <div
              aria-hidden
              className="pointer-events-none absolute rounded-full"
              style={{
                left: menu.origin.x - 260,
                top: menu.origin.y - 260,
                width: 520,
                height: 520,
                background: "radial-gradient(circle, color-mix(in srgb, var(--brand-primary) 35%, transparent) 0%, transparent 62%)",
              }}
            />
            {CORNER_RINGS.map((ring, i) =>
              counts[i] ? (
                <div
                  key={ring.id}
                  aria-hidden
                  className={cn(
                    "pointer-events-none absolute rounded-full border border-dashed transition-colors",
                    selection?.ring === i ? "border-white/45" : "border-white/15",
                  )}
                  style={{
                    left: menu.origin.x - ring.radius,
                    top: menu.origin.y - ring.radius,
                    width: ring.radius * 2,
                    height: ring.radius * 2,
                  }}
                />
              ) : null,
            )}

            <p
              aria-live="polite"
              className="pointer-events-none absolute left-4 font-semibold text-white drop-shadow"
              style={{ top: menu.origin.y - CORNER_RINGS[1].radius - 84 }}
            >
              <span className="block text-[11px] font-medium uppercase tracking-wider text-white/60">
                {selection ? (selection.ring === 0 ? "Acción" : "Abrir") : "Menú rápido"}
              </span>
              <span className="text-xl">{caption}</span>
            </p>

            <div className="absolute" style={{ left: menu.origin.x, top: menu.origin.y }}>
              {rings.map((items, ringIdx) =>
                items.map((item, i) => (
                  <MenuItem
                    key={item.id}
                    item={item}
                    pos={itemOffset(i, items.length, CORNER_RINGS[ringIdx].radius)}
                    active={selection?.ring === ringIdx && selection?.index === i}
                    delay={(ringIdx * 3 + i) * 0.025}
                    onSelect={() => run(item)}
                  />
                )),
              )}
              {/* Labels in their own layer, above every icon, so a neighbor
                  icon never covers them. */}
              {rings.map((items, ringIdx) =>
                (menu.mode === "tap" || ringIdx === 0) &&
                items.map((item, i) => {
                  const p = itemOffset(i, items.length, CORNER_RINGS[ringIdx].radius);
                  return (
                    <motion.span
                      key={`label-${item.id}`}
                      aria-hidden
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.18 }}
                      className="pointer-events-none absolute max-w-20 -translate-x-1/2 truncate whitespace-nowrap rounded-full bg-black/70 px-1.5 text-[10px] font-medium leading-4 text-white"
                      style={{ left: p.x, top: p.y + 26 }}
                    >
                      {item.label}
                    </motion.span>
                  );
                }),
              )}
            </div>

            {finger && menu.mode === "drag" && (
              <span
                aria-hidden
                className="pointer-events-none absolute -ml-3 -mt-3 h-6 w-6 rounded-full border-2 border-white/80 bg-white/20"
                style={{ left: finger.x, top: finger.y }}
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>,
    document.body,
  );
}
