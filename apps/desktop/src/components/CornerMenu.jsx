import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import { Home, NotebookPen, Search } from "lucide-react";
import { cn, useKeyboardOpen } from "@runly/ui";
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

// The grip overlays the bottom-right corner, where screens often place a
// primary action (chat send button). A tap on it is re-dispatched to the
// element underneath so that action keeps working.
function forwardTap(grip, point) {
  grip.style.pointerEvents = "none";
  const target = document.elementFromPoint(point.x, point.y);
  grip.style.pointerEvents = "";
  if (!target || grip.contains(target)) return;
  const el = target.closest("button, a, input, textarea, select, [role='button'], [tabindex]") ?? target;
  if (el.matches?.("input, textarea, select, [contenteditable='true']")) el.focus();
  else el.click();
}

// Bottom-right corner (the left edge is the browser/OS back-swipe gesture):
// the arc fans up and to the left.
function mirror(p) {
  return { x: -p.x, y: p.y };
}

// Mobile corner menu: swipe the grip in the bottom-right corner outward and an
// arc of options fans out. Inner ring = quick actions, outer ring = favorite
// (then recent) apps. Release over an option runs it; release elsewhere (or
// tap the backdrop) closes it. A plain tap on the grip passes through.
export function CornerMenu() {
  const isTouch = useIsTouchDevice();
  // Hidden while the on-screen keyboard is open (not merely on focus: some
  // screens autofocus a field without raising the keyboard).
  const editing = useKeyboardOpen();
  const navigate = useNavigate();
  const { availableModules } = useRuntimeModules();
  const { launch, isOfflineBlocked } = useModuleLauncher(availableModules);
  const { favorites } = useAppViewPrefs();
  const gripRef = useRef(null);
  const gestureRef = useRef(null);
  const [menu, setMenu] = useState(null); // { origin }
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
    gestureRef.current = { start: { x: e.clientX, y: e.clientY }, origin: null };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e) {
    const g = gestureRef.current;
    if (!g) return;
    if (!g.origin) {
      // Only a swipe opens the menu; a tap must reach whatever sits under the
      // grip (e.g. the chat composer's send button).
      if (Math.hypot(e.clientX - g.start.x, e.clientY - g.start.y) <= TAP_MAX_MOVE) return;
      const rect = gripRef.current.getBoundingClientRect();
      // Origin sits a little inside the corner so labels of the first/last
      // items (nearly vertical / horizontal) never fall off the screen edge.
      g.origin = { x: rect.right - 30, y: rect.bottom - 44 };
      setMenu({ origin: g.origin });
      vibrate(8);
    }
    setFinger({ x: e.clientX, y: e.clientY });
    // Bottom-right corner: mirror x so the shared geometry (which fans up and
    // to the right) fans up and to the left instead.
    const next = pickCornerItem(g.origin.x - e.clientX, e.clientY - g.origin.y, counts);
    setSelection((prev) => {
      if (next && (prev?.ring !== next.ring || prev?.index !== next.index)) vibrate(6);
      return next;
    });
  }

  function onPointerUp(e) {
    const g = gestureRef.current;
    gestureRef.current = null;
    if (!g) return;
    if (!g.origin) {
      forwardTap(e.currentTarget, g.start);
      return;
    }
    const item = selection ? rings[selection.ring][selection.index] : null;
    if (item) run(item);
    else close();
  }

  // Escape closes an open menu.
  useEffect(() => {
    if (!menu) return undefined;
    const onKey = (e) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

  if (!isTouch) return null;

  const selected = selection ? rings[selection.ring][selection.index] : null;
  const caption = selected?.label ?? "Desliza hacia una opción y suelta";

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
            "fixed bottom-0 right-0 flex h-14 w-14 touch-none select-none items-end justify-end",
            menu && "opacity-0",
          )}
          style={{
            zIndex: Z_CORNER,
            paddingRight: "env(safe-area-inset-right, 0px)",
            paddingBottom: "env(safe-area-inset-bottom, 0px)",
          }}
        >
          <span
            aria-hidden
            className="block h-12 w-12"
            style={{
              background:
                "radial-gradient(circle at 100% 100%, color-mix(in srgb, var(--brand-primary) 55%, transparent) 0%, color-mix(in srgb, var(--brand-primary) 18%, transparent) 45%, transparent 72%)",
            }}
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
              className="pointer-events-none absolute right-4 text-right font-semibold text-white drop-shadow"
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
                    pos={mirror(itemOffset(i, items.length, CORNER_RINGS[ringIdx].radius))}
                    active={selection?.ring === ringIdx && selection?.index === i}
                    delay={(ringIdx * 3 + i) * 0.025}
                    onSelect={() => run(item)}
                  />
                )),
              )}
              {/* Labels in their own layer, above every icon, so a neighbor
                  icon never covers them. */}
              {rings.map((items, ringIdx) =>
                ringIdx === 0 &&
                items.map((item, i) => {
                  const p = mirror(itemOffset(i, items.length, CORNER_RINGS[ringIdx].radius));
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

            {finger && (
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
