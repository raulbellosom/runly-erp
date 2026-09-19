// apps/desktop/src/modules/runly.chat/hooks/useMeridian.js
import { useQuery } from "@tanstack/react-query";
import { runly } from "../../../lib/runly";
import { useAuth } from "../../../auth/AuthProvider";

// Is MeridIAn available in this environment (GROQ_API_KEY present) AND does the
// caller have chat.meridian.use? A 403/404 -> treat as unavailable, no toast.
export function useMeridianStatus() {
  const { session } = useAuth();
  const token = session?.access_token;
  return useQuery({
    queryKey: ["chat-meridian-status"],
    enabled: Boolean(token),
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      try {
        const res = await runly.chat.meridian.status(token);
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

// Ensure the MeridIAn conversation exists for this user. Called once when the
// chat module opens; the backend also self-heals in GET /chat/conversations.
export function useEnsureMeridianConversation({ enabled = true } = {}) {
  const { session } = useAuth();
  const token = session?.access_token;
  return useQuery({
    queryKey: ["chat-meridian-ensure"],
    enabled: enabled && Boolean(token),
    staleTime: Infinity,
    retry: false,
    queryFn: async () => {
      try {
        const res = await runly.chat.meridian.ensure(token);
        return { conversationId: res?.data?.conversationId ?? null };
      } catch (err) {
        if (err?.status === 403) return { conversationId: null };
        throw err;
      }
    },
  });
}
