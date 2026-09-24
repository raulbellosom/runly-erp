// apps/desktop/src/modules/runly.chat/hooks/useTextToSpeech.js
//
// "Leer en voz alta" — permission-free (any message, any conversation, from
// any sender, not just MirAI): whatever already lets you SEE the message
// text already lets you hear it, same as copying it to the clipboard needs
// no extra permission. Backed by the same runly-tts/Piper service the MirAI
// panel uses (apps/api/src/routes/chat/mirai-tts-service.js) — the route
// lives under /chat/mirai/tts for historical reasons (that's where it was
// first built), but the capability itself is generic now.
import { useCallback, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { runly } from "../../../lib/runly";
import { useAuth } from "../../../auth/AuthProvider";

export function useTtsStatus() {
  const { session } = useAuth();
  const token = session?.access_token;
  return useQuery({
    queryKey: ["chat-tts-status"],
    enabled: Boolean(token),
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const res = await runly.chat.tts.status(token);
      return { enabled: Boolean(res?.data?.enabled) };
    },
  });
}

// One shared <audio> element per hook instance so a second click — on the
// same bubble or a different one — stops whatever was already playing
// instead of overlapping it. No persistence: regenerated on every click (see
// mirai-tts-service.js for why that's cheap enough not to bother caching).
export function useSpeakText() {
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
    mutationFn: (text) => runly.chat.tts.speak(text, token),
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
