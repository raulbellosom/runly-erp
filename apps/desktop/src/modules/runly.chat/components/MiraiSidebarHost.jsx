// apps/desktop/src/modules/runly.chat/components/MiraiSidebarHost.jsx
//
// One MirAI on every screen (spec 2026-09-30-mirai-global-capabilities §1):
// an edge tab that opens a non-modal sidebar with the user's single MirAI
// conversation. Lazy-mounted as a sibling of <main> in RunlyApp so its open
// state survives navigation between modules. Hidden on runly.pfm/
// runly.inventory/runly.chat (they already have their own MirAI surface)
// and whenever MirAI isn't available for this user.
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { useMiraiStatus } from "../hooks/useMirAI";
import { MiraiSidebarThread } from "./MiraiSidebarThread";
import { moduleKeyFromPath, shouldShowMiraiTab, useMiraiOpenRequest } from "../lib/miraiPageContext";

const LS_KEY = "mirai.sidebar.open";

function readOpen() {
  try {
    return localStorage.getItem(LS_KEY) === "1";
  } catch {
    return false;
  }
}

function writeOpen(value) {
  try {
    localStorage.setItem(LS_KEY, value ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function MiraiSidebarHost() {
  const location = useLocation();
  const { data: status } = useMiraiStatus();
  const available = Boolean(status?.available);
  const canUse = status?.forbidden !== true;

  const [open, setOpen] = useState(readOpen);
  useEffect(() => writeOpen(open), [open]);

  // Module screens (e.g. inventory's "Consultar con IA" button) call
  // openMiraiSidebar() to open this host from anywhere; each call bumps a
  // counter this effect reacts to, regardless of the host's current state.
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
    function onKeyDown(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const visible = shouldShowMiraiTab({
    moduleKey: moduleKeyFromPath(location.pathname),
    canUse,
    available,
  });

  if (!visible) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Abrir MirAI"
        className="fixed right-0 top-1/2 z-40 flex -translate-y-1/2 flex-col items-center gap-1 rounded-l-lg bg-[hsl(var(--primary))] px-2 py-3 text-[hsl(var(--primary-foreground))] shadow-lg"
      >
        <Sparkles className="h-4 w-4" />
        <span className="text-[10px] font-semibold tracking-wide [writing-mode:vertical-rl]">MirAI</span>
      </button>
    );
  }

  return (
    <aside className="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-[hsl(var(--border))] bg-[hsl(var(--background))] shadow-xl md:w-[380px]">
      <MiraiSidebarThread onClose={() => setOpen(false)} />
    </aside>
  );
}
