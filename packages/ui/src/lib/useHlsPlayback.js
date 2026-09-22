import { useEffect, useState } from "react";

// Attaches an HLS source (a .m3u8 URL, or a blob: URL wrapping manifest
// text — see runly.chat's ChatRecordingsGallery.jsx, which builds one for
// call recordings) to a <video> ref. hls.js (lazy-loaded so it never enters
// the main bundle) is tried FIRST via Hls.isSupported(), native <video> src
// only as the fallback for genuine Safari/iOS — this order matters and must
// not be flipped: some Chromium builds report
// canPlayType('application/vnd.apple.mpegurl') as truthy without actually
// being able to parse an HLS manifest, which then fails immediately with
// MediaError code 4 (SRC_NOT_SUPPORTED, confirmed against production on
// Windows/Chromium). Matches hls.js's own documented integration snippet.
//
// A real useEffect is required (not useState's lazy initializer, which only
// ever runs once at mount) because `src` typically becomes non-null only
// after the caller resolves it post-mount (e.g. a viewer opening, a row
// expanding) — the effect must re-run then.
//
// `onFatalError` is invoked for hls.js fatal errors (network/media errors
// hls.js itself can't recover from) — the native-Safari path relies on the
// <video> element's own `onError` prop instead (wired by the caller), since
// hls.js's event bus doesn't apply there.
export function useHlsPlayback(videoRef, src, onFatalError) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(false);
    if (!src || !videoRef.current) return undefined;
    const video = videoRef.current;

    let hls;
    let cancelled = false;
    import("hls.js").then(({ default: Hls }) => {
      if (cancelled) return;

      if (Hls.isSupported()) {
        hls = new Hls();
        hls.on(Hls.Events.ERROR, (_event, data) => {
          console.warn("[useHlsPlayback] hls.js error:", data?.type, data?.details, data?.fatal ? "(fatal)" : "(recoverable)", data);
          if (data?.fatal) onFatalError?.();
        });
        hls.loadSource(src);
        hls.attachMedia(video);
        setReady(true);
        return;
      }

      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = src;
        setReady(true);
        return;
      }

      onFatalError?.();
    });

    return () => {
      cancelled = true;
      hls?.destroy();
      // Safe to call unconditionally even when hls.js managed playback instead.
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [src, videoRef, onFatalError]);

  return ready;
}
