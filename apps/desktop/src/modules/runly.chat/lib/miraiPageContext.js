// apps/desktop/src/modules/runly.chat/lib/miraiPageContext.js
//
// What the user is looking at, sent with messages from the global MirAI
// sidebar (spec 2026-09-30-mirai-global-capabilities §7). Module screens
// publish their open record with useMiraiRecordContext(); the route supplies
// the module. The server re-checks access — this is a hint, never a grant.
import { useEffect, useSyncExternalStore } from "react";

const HIDDEN_MODULES = new Set(["runly.chat"]);
let record = null;
const listeners = new Set();
const emit = () => listeners.forEach((l) => l());

export function setMiraiRecordContext(next) {
  record = next && (next.recordId || next.selection) ? next : null;
  emit();
}

// Module screens call this with { recordType, recordId, label } for a single
// open record (detail screens), or { selection } for a list screen's active
// rows/filters (inventory §3: `selection = { mode: "filtered" | "selected",
// ids, filters }`). Either field alone is enough to publish a context.
export function useMiraiRecordContext(ctx) {
  const { recordType, recordId, label, selection } = ctx ?? {};
  useEffect(() => {
    if (!recordId && !selection) return undefined;
    setMiraiRecordContext({
      recordType,
      recordId: recordId != null ? String(recordId) : undefined,
      label: label ? String(label).slice(0, 200) : undefined,
      selection,
    });
    return () => setMiraiRecordContext(null);
  }, [recordType, recordId, label, selection]);
}

// Lets any screen (e.g. an inventory "Consultar con IA" button) open the
// global sidebar without importing MiraiSidebarHost's internal open state.
let openRequestId = 0;
const openListeners = new Set();

export function openMiraiSidebar() {
  openRequestId += 1;
  openListeners.forEach((l) => l());
}

export function useMiraiOpenRequest() {
  return useSyncExternalStore(
    (l) => { openListeners.add(l); return () => openListeners.delete(l); },
    () => openRequestId,
    () => 0,
  );
}

export function useCurrentMiraiRecord() {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => record,
    () => null,
  );
}

export function moduleKeyFromPath(pathname) {
  const m = /^\/app\/m\/([^/?#]+)/.exec(String(pathname ?? ""));
  return m ? decodeURIComponent(m[1]) : null;
}

export function buildMiraiPageContext(pathname, current) {
  const moduleKey = moduleKeyFromPath(pathname);
  if (!moduleKey) return null;
  return { moduleKey, path: String(pathname).slice(0, 200), ...(current ?? {}) };
}

export function shouldShowMiraiTab({ moduleKey, canUse, available }) {
  if (!canUse || !available) return false;
  return !HIDDEN_MODULES.has(moduleKey);
}
