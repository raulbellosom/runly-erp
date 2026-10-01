// apps/desktop/src/modules/runly.chat/hooks/useMiraiThreads.js
//
// The caller's MirAI conversations for the global sidebar (spec
// 2026-10-01-mirai-sidebar-v2 §3). The active thread id is remembered per
// browser; without one the sidebar falls back to the latest thread.
import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { runly } from "../../../lib/runly";
import { useAuth } from "../../../auth/AuthProvider";

const LS_KEY = "mirai.sidebar.thread";
const KEY = ["chat-mirai-threads"];

function readActive() {
  try { return localStorage.getItem(LS_KEY) || null; } catch { return null; }
}
function writeActive(id) {
  try { if (id) localStorage.setItem(LS_KEY, id); else localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
}

export function useMiraiThreads({ enabled = true } = {}) {
  const { session } = useAuth();
  const token = session?.access_token;
  const qc = useQueryClient();
  const [activeId, setActiveIdState] = useState(readActive);

  const setActiveId = useCallback((id) => { setActiveIdState(id); writeActive(id); }, []);

  const threads = useQuery({
    queryKey: KEY,
    enabled: enabled && Boolean(token),
    staleTime: 10_000,
    queryFn: async () => (await runly.chat.mirai.threads(token))?.data ?? [],
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: KEY });
    qc.invalidateQueries({ queryKey: ["chat-conversations"] });
  };

  const create = useMutation({
    mutationFn: async () => (await runly.chat.mirai.createThread(token))?.data,
    onSuccess: (thread) => {
      if (!thread?.id) return;
      // Put the new thread in the cached list before activating it; otherwise
      // the panel falls back to the previous thread until the refetch lands.
      qc.setQueryData(KEY, (old) => [
        { id: thread.id, title: thread.title, lastMessageAt: new Date().toISOString(), preview: "" },
        ...(old ?? []).filter((t) => t.id !== thread.id),
      ]);
      setActiveId(thread.id);
      refresh();
    },
  });
  const rename = useMutation({
    mutationFn: ({ id, title }) => runly.chat.mirai.renameThread(id, title, token),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (id) => runly.chat.mirai.deleteThread(id, token),
    onSuccess: (_data, id) => { if (id === activeId) setActiveId(null); refresh(); },
  });

  const list = threads.data ?? [];
  // A remembered id that no longer exists (deleted elsewhere) falls back to the latest.
  const resolvedActiveId = list.some((t) => t.id === activeId) ? activeId : (list[0]?.id ?? null);

  return { threads, list, activeId: resolvedActiveId, setActiveId, create, rename, remove, refresh };
}
