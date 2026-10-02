// apps/desktop/src/modules/runly.chat/components/MiraiSidebarHost.jsx
//
// One MirAI on every screen (spec 2026-10-01-mirai-sidebar-v2 §3). Docked
// next to <main> in RunlyApp (below the top bar) with a slide-in width
// transition; a Sheet on touch devices. ModuleAssistantPanel draws the
// conversation list and the chat header; MiraiSidebarThread renders one
// conversation. Hidden in runly.chat (it has its own MirAI surfaces) and
// whenever MirAI is unavailable for this user.
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  AssistantWordmark, Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input,
  ModuleAssistantPanel, Sheet, SheetContent, SheetTitle, useCoarsePointer,
} from "@runly/ui";
import { ExternalLink, Pencil, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useEnsureMiraiConversation, useMiraiStatus } from "../hooks/useMirAI";
import { useMiraiThreads } from "../hooks/useMiraiThreads";
import { MiraiSidebarThread } from "./MiraiSidebarThread";
import { moduleKeyFromPath, setVisibleMiraiConversation, shouldShowMiraiTab, useMiraiOpenRequest } from "../lib/miraiPageContext";
import { useChatPreferences, chatPreferencesStyle } from "../hooks/useChatPreferences";
import "../chat-theme.css";

const LS_KEY = "mirai.sidebar.open";

function readOpen() {
  try { return localStorage.getItem(LS_KEY) === "1"; } catch { return false; }
}
function writeOpen(value) {
  try { localStorage.setItem(LS_KEY, value ? "1" : "0"); } catch { /* ignore */ }
}

// Edge-tab position: snapped to the left or right edge, vertical position as a
// viewport fraction so it survives window resizes.
const TAB_POS_KEY = "mirai.tab.position";
const TAB_MARGIN = 56;

function readTabPos() {
  try {
    const raw = JSON.parse(localStorage.getItem(TAB_POS_KEY));
    if (raw && (raw.side === "left" || raw.side === "right") && Number.isFinite(raw.y)) return raw;
  } catch { /* ignore */ }
  return { side: "right", y: 0.5 };
}
function writeTabPos(pos) {
  try { localStorage.setItem(TAB_POS_KEY, JSON.stringify(pos)); } catch { /* ignore */ }
}
function clampTabY(px) {
  const h = window.innerHeight;
  return Math.min(Math.max(px, TAB_MARGIN), h - TAB_MARGIN);
}

// Click opens; dragging past a small threshold moves the tab and on release it
// snaps to the nearest side edge.
function useDraggableTab(onClick) {
  const [pos, setPos] = useState(readTabPos);
  const [drag, setDrag] = useState(null);
  const startRef = useRef(null);
  const movedRef = useRef(false);

  function onPointerDown(e) {
    if (e.button !== 0) return;
    startRef.current = { x: e.clientX, y: e.clientY, type: e.pointerType };
    movedRef.current = false;
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e) {
    const start = startRef.current;
    if (!start) return;
    const threshold = start.type === "touch" ? 12 : 6;
    if (!movedRef.current && Math.hypot(e.clientX - start.x, e.clientY - start.y) < threshold) return;
    movedRef.current = true;
    setDrag({ x: e.clientX, y: clampTabY(e.clientY) });
  }
  function onPointerUp(e) {
    if (!startRef.current) return;
    startRef.current = null;
    if (movedRef.current) {
      const next = {
        side: e.clientX < window.innerWidth / 2 ? "left" : "right",
        y: clampTabY(e.clientY) / window.innerHeight,
      };
      setPos(next);
      writeTabPos(next);
      setDrag(null);
    } else {
      onClick();
    }
  }
  function onPointerCancel() {
    startRef.current = null;
    movedRef.current = false;
    setDrag(null);
  }

  return { pos, drag, handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel } };
}

function threadMeta(thread) {
  const when = thread.lastMessageAt
    ? new Date(thread.lastMessageAt).toLocaleDateString("es-MX", { day: "numeric", month: "short" })
    : "";
  return [when, thread.preview].filter(Boolean).join(" · ");
}

export function MiraiSidebarHost() {
  const location = useLocation();
  const { data: status } = useMiraiStatus();
  const visible = shouldShowMiraiTab({
    moduleKey: moduleKeyFromPath(location.pathname),
    canUse: status?.forbidden !== true,
    available: Boolean(status?.available),
  });

  const [open, setOpen] = useState(readOpen);
  // Mount the panel content only after the first open, then keep it mounted
  // so drafts and scroll position survive closing and reopening.
  const [openedOnce, setOpenedOnce] = useState(open);
  useEffect(() => { writeOpen(open); if (open) setOpenedOnce(true); }, [open]);

  // openMiraiSidebar() from any module screen opens the panel.
  const openRequest = useMiraiOpenRequest();
  const seenOpenRequest = useRef(openRequest);
  useEffect(() => {
    if (openRequest !== seenOpenRequest.current) {
      seenOpenRequest.current = openRequest;
      setOpen(true);
    }
  }, [openRequest]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const coarse = useCoarsePointer();
  const { prefs } = useChatPreferences();
  const tab = useDraggableTab(() => setOpen(true));
  if (!visible) return null;

  const left = tab.pos.side === "left";
  const tabStyle = tab.drag
    ? { left: tab.drag.x, top: tab.drag.y, right: "auto", transform: "translate(-50%, -50%)" }
    : { top: `${tab.pos.y * 100}%` };

  const panel = openedOnce && <MiraiPanel open={open} coarse={coarse} onClose={coarse ? undefined : () => setOpen(false)} />;

  return (
    <>
      {!open && (
        <Button
          variant="outline"
          aria-label="Abrir MirAI"
          title="Abrir MirAI (arrastra para moverlo)"
          {...tab.handlers}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(true); } }}
          style={tabStyle}
          className={[
            "group fixed z-40 touch-none select-none justify-start gap-0 overflow-hidden bg-[hsl(var(--background))]/90 px-3 text-[hsl(var(--muted-foreground))] shadow-md backdrop-blur hover:gap-2 hover:bg-[hsl(var(--muted))] hover:px-4 hover:text-[hsl(var(--foreground))] hover:shadow-lg",
            tab.drag
              ? "cursor-grabbing rounded-full shadow-xl"
              : [
                "-translate-y-1/2 transition-all duration-200 motion-reduce:transition-none",
                left ? "left-0 flex-row-reverse rounded-l-none rounded-r-full border-l-0" : "right-0 rounded-l-full rounded-r-none border-r-0",
              ].join(" "),
          ].join(" ")}
        >
          <Sparkles className="h-4 w-4 shrink-0" />
          <span className="max-w-0 overflow-hidden whitespace-nowrap text-sm font-medium opacity-0 transition-all duration-200 group-hover:max-w-24 group-hover:opacity-100 motion-reduce:transition-none">
            <AssistantWordmark />
          </span>
        </Button>
      )}

      {coarse ? (
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="right" className="chat-glass-theme flex h-[90dvh] w-full flex-col gap-0 p-0 sm:max-w-lg" style={chatPreferencesStyle(prefs)}>
            <SheetTitle className="sr-only">MirAI</SheetTitle>
            {panel}
          </SheetContent>
        </Sheet>
      ) : (
        <aside
          aria-label="MirAI"
          aria-hidden={!open}
          className={[
            "h-full min-h-0 shrink-0 overflow-hidden bg-[hsl(var(--background))] transition-[width] duration-200 ease-out motion-reduce:transition-none",
            open ? "w-[390px] border-l border-[hsl(var(--border))]" : "w-0",
          ].join(" ")}
        >
          <div className="chat-glass-theme flex h-full w-[390px] min-h-0 flex-col" style={chatPreferencesStyle(prefs)}>{panel}</div>
        </aside>
      )}
    </>
  );
}

function MiraiPanel({ open, coarse, onClose }) {
  const navigate = useNavigate();
  const threadsApi = useMiraiThreads();
  const { list, activeId, setActiveId, create, rename, remove, refresh, threads } = threadsApi;
  // First use: no threads yet -> ensure creates the first one.
  const ensure = useEnsureMiraiConversation({ enabled: threads.isSuccess && list.length === 0 });
  const conversationId = activeId ?? ensure.data?.conversationId ?? null;
  useEffect(() => {
    if (ensure.data?.conversationId && list.length === 0) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ensure.data?.conversationId]);

  const [view, setView] = useState("chat");
  // Tell RealtimeProvider which MirAI conversation is on screen.
  const visibleId = open && view === "chat" ? conversationId : null;
  useEffect(() => {
    setVisibleMiraiConversation(visibleId);
    return () => setVisibleMiraiConversation(null);
  }, [visibleId]);
  const [renaming, setRenaming] = useState(null);
  const active = list.find((t) => t.id === conversationId);

  async function startNew() {
    try { await create.mutateAsync(); setView("chat"); }
    catch (err) { toast.error(err?.message ?? "No se pudo crear la conversación."); }
  }

  async function saveRename() {
    try {
      await rename.mutateAsync({ id: renaming.id, title: renaming.title });
      setRenaming(null);
    } catch (err) {
      toast.error(err?.message ?? "No se pudo renombrar la conversación.");
    }
  }

  return (
    <>
      <ModuleAssistantPanel
        view={view}
        subtitle="Tu asistente en todo Runly"
        listLabel="Conversaciones de MirAI"
        onBack={() => setView("list")}
        onClose={onClose}
        headerClassName={coarse ? "pr-12" : undefined}
        conversations={list.map((t) => ({ id: t.id, title: t.title, meta: threadMeta(t) }))}
        conversationsLoading={threads.isLoading}
        conversationsError={threads.error?.message}
        activeId={conversationId}
        onSelect={(item) => { setActiveId(item.id); setView("chat"); }}
        onNew={startNew}
        onDelete={async (item) => {
          try { await remove.mutateAsync(item.id); }
          catch (err) { toast.error(err?.message ?? "No se pudo eliminar la conversación."); }
        }}
        chatTitle={active?.title ?? "MirAI"}
        chatContext={
          <div className="flex flex-wrap gap-1">
            <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={!active} onClick={() => setRenaming({ id: active.id, title: active.title })}>
              <Pencil className="mr-1 h-3.5 w-3.5" />Renombrar
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={!conversationId}
              onClick={() => navigate(`/app/m/runly.chat/chat/inbox/${conversationId}`)}>
              <ExternalLink className="mr-1 h-3.5 w-3.5" />Abrir en Chat
            </Button>
          </div>
        }
        busy={create.isPending}
      >
        <MiraiSidebarThread key={conversationId ?? "none"} conversationId={conversationId} onSent={refresh} />
      </ModuleAssistantPanel>

      <Dialog open={Boolean(renaming)} onOpenChange={(value) => !value && setRenaming(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Renombrar conversación</DialogTitle></DialogHeader>
          <Input
            value={renaming?.title ?? ""}
            maxLength={80}
            autoFocus
            onChange={(e) => setRenaming((r) => ({ ...r, title: e.target.value }))}
            onKeyDown={(e) => { if (e.key === "Enter") saveRename(); }}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenaming(null)}>Cancelar</Button>
            <Button disabled={!renaming?.title?.trim() || rename.isPending} onClick={saveRename}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
