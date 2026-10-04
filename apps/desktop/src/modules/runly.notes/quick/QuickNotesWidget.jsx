import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  ChevronDown,
  ExternalLink,
  Maximize2,
  Minimize2,
  Minus,
  NotebookPen,
  Plus,
  X,
} from "lucide-react";
import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@runly/ui";
import { useRuntimeModules } from "../../../app/useRuntimeModules";
import { useQuickNoteStore } from "./quickNoteStore";
import { useQuickNotes } from "./useQuickNotes";
import {
  clampToViewport,
  defaultPosition,
  isQuickNoteShortcut,
  passedDragThreshold,
} from "./quickNotePosition";

// The rich editor (TipTap + Y.js) is only downloaded once the panel opens.
const NoteEditor = lazy(() =>
  import("../components/NoteEditor.jsx").then((m) => ({ default: m.NoteEditor })),
);

// Above the call room (z-46) and the chat hub (z-45), below modals (z-50).
const Z_QUICK_NOTES = 48;
// Sized for the full Notes editor (toolbar included).
const PANEL_SIZE = { width: 420, height: 480 };
const PANEL_SIZE_EXPANDED = { width: 640, height: 640 };
const BUBBLE_SIZE = { width: 48, height: 48 };
const NARROW_BREAKPOINT = 640;
export const QUICK_NOTE_SHORTCUT_LABEL = "Ctrl+Alt+N";

function viewportSize() {
  return { width: window.innerWidth, height: window.innerHeight };
}

// Pointer-drag for a fixed-position box. Clicks under the threshold are not
// drags, so the bubble's tap-to-restore keeps working.
function useDraggable({ pos, size, onMove, onTap }) {
  const startRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  function onPointerDown(e) {
    if (e.button !== 0 || e.target.closest("[data-no-drag]")) return;
    startRef.current = { x: e.clientX, y: e.clientY, origin: pos, type: e.pointerType, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e) {
    const s = startRef.current;
    if (!s) return;
    if (!s.moved && !passedDragThreshold(s, { x: e.clientX, y: e.clientY }, s.type)) return;
    s.moved = true;
    setDragging(true);
    onMove(
      clampToViewport(
        { x: s.origin.x + e.clientX - s.x, y: s.origin.y + e.clientY - s.y },
        size,
        viewportSize(),
      ),
    );
  }
  function onPointerUp() {
    const s = startRef.current;
    startRef.current = null;
    setDragging(false);
    if (s && !s.moved) onTap?.();
  }
  return {
    dragging,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp },
  };
}

function HeaderButton({ label, onClick, children }) {
  return (
    <button
      type="button"
      data-no-drag
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
    >
      {children}
    </button>
  );
}

function noteTitle(note) {
  return note?.title?.trim() || "Nota sin título";
}

function QuickNotesPanel() {
  const navigate = useNavigate();
  const { expanded, panelPos, setPanelPos, mobileY, setMobileY, minimize, close, toggleExpanded } =
    useQuickNoteStore();
  const { notes, note, isLoading, isError, createNote, selectNote, creating } = useQuickNotes({
    enabled: true,
  });
  const vp = viewportSize();
  // Phones: full width, only dragged up/down (no resize; starts near the top,
  // clear of the on-screen keyboard). Larger screens: free-floating window.
  const narrow = vp.width < NARROW_BREAKPOINT;
  const size = narrow
    ? { width: vp.width - 16, height: Math.min(480, Math.round(vp.height * 0.6)) }
    : expanded ? PANEL_SIZE_EXPANDED : PANEL_SIZE;
  const pos = narrow
    ? { x: 8, y: clampToViewport({ x: 8, y: mobileY ?? 64 }, size, vp, 8).y }
    : clampToViewport(panelPos ?? defaultPosition(size, vp), size, vp);
  const { dragging, handlers } = useDraggable({
    pos,
    size,
    onMove: narrow ? (p) => setMobileY(p.y) : setPanelPos,
  });
  const sectionRef = useRef(null);

  // Ready to type: focus the editor once the note's editor has mounted.
  const noteId = note?.id;
  useEffect(() => {
    if (!noteId) return undefined;
    let tries = 0;
    const timer = setInterval(() => {
      const editable = sectionRef.current?.querySelector(".ProseMirror[contenteditable='true']");
      if (editable || ++tries > 40) {
        clearInterval(timer);
        editable?.focus();
      }
    }, 50);
    return () => clearInterval(timer);
  }, [noteId]);

  return (
    <section
      ref={sectionRef}
      role="dialog"
      aria-label="Nota rápida"
      className={cn(
        "fixed flex flex-col overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-2xl",
        dragging ? "shadow-[0_24px_60px_-12px_rgba(0,0,0,0.45)]" : "transition-[width,height] duration-200",
      )}
      style={{ left: pos.x, top: pos.y, width: size.width, height: size.height, zIndex: Z_QUICK_NOTES }}
      onKeyDown={(e) => {
        if (e.key === "Escape") minimize();
      }}
    >
      <header
        {...handlers}
        className={cn(
          "flex shrink-0 touch-none select-none items-center gap-1 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]/40 py-1.5 pl-3 pr-1.5",
          dragging ? "cursor-grabbing" : "cursor-grab",
        )}
      >
        <NotebookPen size={16} aria-hidden className="shrink-0 text-amber-500" />
        {/* Title is plain text so the whole header stays a drag handle; the
            note switcher lives on its own chevron button. */}
        <span className="min-w-0 truncate px-1 text-sm font-semibold text-[hsl(var(--foreground))]">
          {note ? noteTitle(note) : "Nota rápida"}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              data-no-drag
              aria-label="Cambiar de nota"
              title="Cambiar de nota"
              className="flex h-7 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
            >
              <ChevronDown size={14} aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-80 w-72 overflow-y-auto">
            <DropdownMenuLabel>Mis notas</DropdownMenuLabel>
            {notes.map((n) => (
              <DropdownMenuItem key={n.id} onSelect={() => selectNote(n.id)}>
                <span className={cn("truncate", n.id === note?.id && "font-semibold")}>{noteTitle(n)}</span>
              </DropdownMenuItem>
            ))}
            {notes.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuItem onSelect={() => createNote()}>
              <Plus size={14} aria-hidden />
              Nueva nota
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="flex-1" />
        <HeaderButton label="Nueva nota" onClick={() => createNote()}>
          <Plus size={15} />
        </HeaderButton>
        {note && (
          <HeaderButton
            label="Abrir en Notas"
            onClick={() => {
              const params = new URLSearchParams({ note: note.id });
              if (note.folder_id) params.set("folder", note.folder_id);
              navigate(`/app/m/runly.notes?${params}`);
              minimize();
            }}
          >
            <ExternalLink size={14} />
          </HeaderButton>
        )}
        {!narrow && (
          <HeaderButton label={expanded ? "Reducir" : "Ampliar"} onClick={toggleExpanded}>
            {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </HeaderButton>
        )}
        <HeaderButton label="Minimizar" onClick={minimize}>
          <Minus size={15} />
        </HeaderButton>
        <HeaderButton label="Cerrar" onClick={close}>
          <X size={15} />
        </HeaderButton>
      </header>

      <div className="min-h-0 flex-1">
        {isError ? (
          <p className="p-4 text-sm text-[hsl(var(--muted-foreground))]">
            No se pudieron cargar tus notas.
          </p>
        ) : note && !creating ? (
          <Suspense fallback={<EditorSkeleton />}>
            <NoteEditor key={note.id} note={note} />
          </Suspense>
        ) : isLoading || creating ? (
          <EditorSkeleton />
        ) : null}
      </div>

      <footer className="flex shrink-0 items-center justify-between border-t border-[hsl(var(--border))] px-3 py-1.5 text-[11px] text-[hsl(var(--muted-foreground))]">
        <span>Se guarda automáticamente</span>
        {!narrow && <kbd className="font-mono">{QUICK_NOTE_SHORTCUT_LABEL}</kbd>}
      </footer>
    </section>
  );
}

function EditorSkeleton() {
  return (
    <div className="space-y-2.5 p-4">
      <div className="h-4 w-1/2 animate-pulse rounded bg-[hsl(var(--muted))]" />
      <div className="h-3 w-5/6 animate-pulse rounded bg-[hsl(var(--muted))]" />
      <div className="h-3 w-2/3 animate-pulse rounded bg-[hsl(var(--muted))]" />
    </div>
  );
}

function QuickNotesBubble() {
  const { bubblePos, setBubblePos, restore } = useQuickNoteStore();
  const vp = viewportSize();
  // Default: right edge, stacked just above the chat bubble (which sits at
  // 75% of the viewport height).
  const pos = clampToViewport(
    bubblePos ?? { x: vp.width - BUBBLE_SIZE.width - 20, y: vp.height * 0.75 - 28 - BUBBLE_SIZE.height - 16 },
    BUBBLE_SIZE,
    vp,
  );
  const { dragging, handlers } = useDraggable({ pos, size: BUBBLE_SIZE, onMove: setBubblePos, onTap: restore });

  return (
    <button
      type="button"
      {...handlers}
      aria-label={`Abrir nota rápida (${QUICK_NOTE_SHORTCUT_LABEL})`}
      title={`Nota rápida (${QUICK_NOTE_SHORTCUT_LABEL})`}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          restore();
        }
      }}
      className={cn(
        "fixed flex touch-none select-none items-center justify-center rounded-full bg-amber-500 text-white shadow-lg ring-4 ring-amber-500/20 focus-visible:outline-none focus-visible:ring-[hsl(var(--ring))]",
        dragging ? "scale-110 cursor-grabbing shadow-2xl" : "cursor-pointer transition-transform hover:scale-105 active:scale-95",
      )}
      style={{ left: pos.x, top: pos.y, width: BUBBLE_SIZE.width, height: BUBBLE_SIZE.height, zIndex: Z_QUICK_NOTES }}
    >
      <NotebookPen size={20} aria-hidden />
    </button>
  );
}

// Global floating quick-notes: survives navigation (mounted in the app shell),
// draggable, minimizable to a bubble, toggled with Ctrl+Alt+N.
export function QuickNotesWidget() {
  const { availableModules } = useRuntimeModules();
  const available = availableModules.some((m) => m.key === "runly.notes");
  const isOpen = useQuickNoteStore((s) => s.isOpen);
  const minimized = useQuickNoteStore((s) => s.minimized);
  const toggleFromShortcut = useQuickNoteStore((s) => s.toggleFromShortcut);
  const [, forceRender] = useState(0);

  useEffect(() => {
    if (!available) return undefined;
    function onKeyDown(e) {
      if (!isQuickNoteShortcut(e)) return;
      e.preventDefault();
      toggleFromShortcut();
    }
    // Re-clamp positions when the window shrinks.
    function onResize() {
      forceRender((n) => n + 1);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onResize);
    };
  }, [available, toggleFromShortcut]);

  if (!available || !isOpen) return null;
  // Portaled to <body>: the app shell root is position:fixed (its own stacking
  // context), which would keep this under the full-screen call room.
  return createPortal(minimized ? <QuickNotesBubble /> : <QuickNotesPanel />, document.body);
}
