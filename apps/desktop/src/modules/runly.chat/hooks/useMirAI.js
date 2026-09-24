// apps/desktop/src/modules/runly.chat/hooks/useMirAI.js
import { useCallback, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { runly } from "../../../lib/runly";
import { useAuth } from "../../../auth/AuthProvider";

// Is MirAI available in this environment (GROQ_API_KEY present) AND does the
// caller have chat.mirai.use? A 403/404 -> treat as unavailable, no toast.
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
        return {
          available: Boolean(res?.data?.available),
          tts: Boolean(res?.data?.tts),
        };
      } catch (err) {
        if (err?.status === 403 || err?.status === 404) {
          return { available: false, tts: false, forbidden: err?.status === 403 };
        }
        throw err;
      }
    },
  });
}

// "Leer en voz alta" — one shared <audio> element per hook instance so a
// second click on the same or another bubble stops whatever was already
// playing instead of overlapping it. No persistence: regenerated on every
// click (see mirai-tts-service.js for why that's fine performance-wise).
export function useSpeakMirai() {
  const { session } = useAuth();
  const token = session?.access_token;
  const audioRef = useRef(null);
  const urlRef = useRef(null);
  const [playingText, setPlayingText] = useState(null);
  const [loadingText, setLoadingText] = useState(null);

  const cleanup = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    setPlayingText(null);
  }, []);

  const mutation = useMutation({
    mutationFn: (text) => runly.chat.mirai.speak(text, token),
  });

  const speak = useCallback(async (text) => {
    // Clicking the button that's already playing just stops it.
    if (playingText === text) { cleanup(); return; }
    cleanup();
    setLoadingText(text);
    try {
      const blob = await mutation.mutateAsync(text);
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      urlRef.current = url;
      audio.addEventListener("ended", cleanup);
      setPlayingText(text);
      await audio.play();
    } finally {
      setLoadingText(null);
    }
  }, [cleanup, mutation, playingText]);

  return {
    speak,
    stop: cleanup,
    isPlaying: (text) => playingText === text,
    isLoading: (text) => loadingText === text,
  };
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
