import { useEffect } from "react";

// Keeps the screen awake (no dim / auto-lock) while `active` is true, via the
// Screen Wake Lock API. The browser releases the lock whenever the page is
// hidden, so it is re-requested on every return to the foreground. Silently a
// no-op where the API is missing (older Safari/Firefox) or denied.
export function useScreenWakeLock(active = true) {
  useEffect(() => {
    const wakeLock = globalThis.navigator?.wakeLock;
    if (!active || !wakeLock?.request) return undefined;

    let sentinel = null;
    let disposed = false;

    const acquire = async () => {
      if (disposed || document.visibilityState !== "visible") return;
      if (sentinel && !sentinel.released) return;
      try {
        const next = await wakeLock.request("screen");
        if (disposed) next.release().catch(() => {});
        else sentinel = next;
      } catch {
        /* denied (battery saver, no user activation, policy) — non-fatal */
      }
    };

    const onVisibility = () => { acquire(); };

    acquire();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibility);
      sentinel?.release().catch(() => {});
      sentinel = null;
    };
  }, [active]);
}
