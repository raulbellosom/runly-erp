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
  if (!visible) return null;

  const panel = openedOnce && <MiraiPanel open={open} coarse={coarse} onClose={coarse ? undefined : () => setOpen(false)} />;

  return (
    <>
      {!open && (
        <Button
          variant="outline"
          aria-label="Abrir MirAI"
          onClick={() => setOpen(true)}
          className="group fixed right-0 top-1/2 z-40 -translate-y-1/2 justify-start gap-0 overflow-hidden rounded-l-full rounded-r-none border-r-0 bg-[hsl(var(--background))]/90 px-3 text-[hsl(var(--muted-foreground))] shadow-md backdrop-blur transition-all duration-200 hover:gap-2 hover:bg-[hsl(var(--muted))] hover:px-4 hover:text-[hsl(var(--foreground))] hover:shadow-lg motion-reduce:transition-none"
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
