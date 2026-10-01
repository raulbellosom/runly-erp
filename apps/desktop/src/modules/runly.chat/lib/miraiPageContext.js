// apps/desktop/src/modules/runly.chat/lib/miraiPageContext.js
//
// What the user is looking at, sent with messages from the global MirAI
// sidebar (spec 2026-09-30-mirai-global-capabilities §7). Module screens
// publish their open record with useMiraiRecordContext(); the route supplies
// the module. The server re-checks access — this is a hint, never a grant.
import { useEffect, useSyncExternalStore } from "react";

const HIDDEN_MODULES = new Set(["runly.inventory", "runly.chat"]);
let record = null;
const listeners = new Set();
const emit = () => listeners.forEach((l) => l());

export function setMiraiRecordContext(next) {
  record = next && next.recordId ? next : null;
  emit();
}

export function useMiraiRecordContext(ctx) {
  const { recordType, recordId, label } = ctx ?? {};
  useEffect(() => {
    if (!recordId) return undefined;
    setMiraiRecordContext({ recordType, recordId: String(recordId), label: label ? String(label).slice(0, 200) : undefined });
    return () => setMiraiRecordContext(null);
  }, [recordType, recordId, label]);
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
