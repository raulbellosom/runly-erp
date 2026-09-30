import { useEffect, useRef } from "react";
import { native } from "../../../../native";
import { rejoinDelayMs } from "../lib/callReconnect";

// Rejoins the call with a fresh token after the connection drops (device
// locked/asleep, network lost). Retries when the page is visible again, the
// network returns, or on a capped backoff that only resets once connected.
// `rejoin` rejects to retry; a call that ended meanwhile is expected to be
// closed by the caller instead.
export function useCallAutoRejoin({ needsRejoin, connected, rejoin }) {
  const rejoinRef = useRef(rejoin);
  rejoinRef.current = rejoin;
  const attemptRef = useRef(0);

  useEffect(() => {
    if (connected) attemptRef.current = 0;
  }, [connected]);

  useEffect(() => {
    if (!needsRejoin || !rejoinRef.current) return undefined;
    let cancelled = false;
    let inFlight = false;
    let timer = null;

    const tryRejoin = async () => {
      if (cancelled || inFlight || document.visibilityState !== "visible") return;
      if (globalThis.navigator?.onLine === false) return;
      inFlight = true;
      window.clearTimeout(timer);
      attemptRef.current += 1;
      try {
        await rejoinRef.current();
      } catch {
        if (!cancelled) timer = window.setTimeout(tryRejoin, rejoinDelayMs(attemptRef.current));
      } finally {
        inFlight = false;
      }
    };

    timer = window.setTimeout(tryRejoin, rejoinDelayMs(attemptRef.current));
    document.addEventListener("visibilitychange", tryRejoin);
    window.addEventListener("online", tryRejoin);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", tryRejoin);
      window.removeEventListener("online", tryRejoin);
    };
  }, [needsRejoin]);
}

// Android app: holds a foreground service for the life of the call so the
// system keeps mic/audio/network alive with the screen locked. Re-sent when
// the mic/camera go live so the service gains those types once granted.
export function useNativeCallKeepAlive({ video, micLive, cameraLive }) {
  useEffect(() => {
    native.callKeepAlive.start({ video }).catch(() => {});
  }, [video, micLive, cameraLive]);

  useEffect(() => () => { native.callKeepAlive.stop().catch(() => {}); }, []);
}
