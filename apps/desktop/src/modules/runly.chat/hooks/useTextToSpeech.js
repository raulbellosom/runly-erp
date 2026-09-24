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
    // Also clears an in-flight "loading" state immediately on stop, rather
    // than waiting for the network request to actually resolve — the
    // request itself keeps running in the background, but its result gets
    // discarded (see the `audioRef.current !== audio` guard in speak()).
    setLoadingText(null);
  }, []);

  const mutation = useMutation({
    mutationFn: (text) => runly.chat.tts.speak(text, token),
  });

  const speak = useCallback(async (text) => {
    // Clicking the button again while it's already playing OR still loading
    // just stops/cancels it, instead of firing a second, redundant request.
    if (playingText === text || loadingText === text) { cleanup(); return; }
    cleanup();

    // iOS Safari (and other WebKit-based mobile browsers) only allows
    // audio.play() when it's still tied to the user gesture that triggered
    // it — once this function `await`s the network round-trip below, the
    // gesture is no longer "fresh" by the time playback would start, and
    // play() throws NotAllowedError ("...possibly because the user denied
    // permission", a real report: a short reply synthesized fast enough
    // stayed inside whatever grace window Safari allows, a longer one
    // didn't). Fix: create the <audio> element and call play() on it
    // SYNCHRONOUSLY, right now, before any await — with no source yet, that
    // call is expected to reject (nothing to play), but it "unlocks" this
    // specific element against the current gesture, so setting its `src`
    // and calling play() again later, after the network call, still works.
    const audio = new Audio();
    audio.play().catch(() => {});
    audioRef.current = audio;

    setLoadingText(text);
    try {
      const blob = await mutation.mutateAsync(text);
      // Superseded while the request was in flight (stopped, or a different
      // message started playing) — don't resurrect this element.
      if (audioRef.current !== audio) return;
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      audio.src = url;
      audio.addEventListener("ended", cleanup);
      setPlayingText(text);
      await audio.play();
    } finally {
      setLoadingText(null);
    }
  }, [cleanup, mutation, playingText, loadingText]);

  return {
    speak,
    stop: cleanup,
    isPlaying: (text) => playingText === text,
    isLoading: (text) => loadingText === text,
    // For a global "now playing" indicator (TtsNowPlayingBar) that doesn't
    // know or care WHICH message's text is involved, only whether something
    // is happening right now.
    isAnyLoading: loadingText !== null,
    isAnyPlaying: playingText !== null,
  };
}
