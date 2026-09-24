// apps/desktop/src/modules/runly.chat/hooks/useMirAI.js
import { useQuery } from "@tanstack/react-query";
import { runly } from "../../../lib/runly";
import { useAuth } from "../../../auth/AuthProvider";

// Is MirAI available in this environment (GROQ_API_KEY present) AND does the
// caller have chat.mirai.use? A 403/404 -> treat as unavailable, no toast.
// "Leer en voz alta" is a separate, permission-free capability now (any
// message, any conversation) — see hooks/useTextToSpeech.js, not this file.
export function useMiraiStatus() {
  const { session } = useAuth();
  const token = session?.access_token;
  return useQuery({
    queryKey: ["chat-mirai-status"],
    enabled: Boolean(token),
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      try {
        const res = await runly.chat.mirai.status(token);
        return { available: Boolean(res?.data?.available) };
      } catch (err) {
        if (err?.status === 403 || err?.status === 404) {
          return { available: false, forbidden: err?.status === 403 };
        }
        throw err;
      }
    },
  });
}

// Ensure the MirAI conversation exists for this user. Called once when the
// chat module opens; the backend also self-heals in GET /chat/conversations.
export function useEnsureMiraiConversation({ enabled = true } = {}) {
  const { session } = useAuth();
  const token = session?.access_token;
  return useQuery({
    queryKey: ["chat-mirai-ensure"],
    enabled: enabled && Boolean(token),
    staleTime: Infinity,
    retry: false,
    queryFn: async () => {
      try {
        const res = await runly.chat.mirai.ensure(token);
        return { conversationId: res?.data?.conversationId ?? null };
      } catch (err) {
        if (err?.status === 403) return { conversationId: null };
        throw err;
      }
    },
  });
}
