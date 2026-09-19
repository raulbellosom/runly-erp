import { useEffect } from "react";
import { getSupabaseClient } from "../../../lib/supabase";
import { shouldResumeCallOnDevice } from "./callDeviceSession";
import { leaveCallOnPageHide } from "./callLifecycle";

const CURRENT_CALL_POLL_MS = 20_000;

export function useCallSynchronization({
  enabled,
  token,
  userId,
  activeCallId,
  incomingCallId,
  onRealtime,
  syncCurrentCall,
  fetchCall,
  presentIncomingCall,
  rejectIncomingWhileBusy,
  finishLocalCall,
  dismissAnsweredOnOtherDevice,
}) {
  // Realtime is the fast path. Polling plus focus/visibility recovery is the
  // reliability path for suspended mobile PWAs and reconnected channels.
  useEffect(() => {
    if (!enabled || !token || !userId || activeCallId) return undefined;
    let running = false;
    async function sync() {
      if (running) return;
      running = true;
      try {
        await syncCurrentCall();
      } catch (error) {
        console.warn("[atlas.calls] No se pudo sincronizar la llamada actual:", error);
      } finally {
        running = false;
      }
    }
    const timer = window.setInterval(sync, CURRENT_CALL_POLL_MS);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") sync();
    };
    window.addEventListener("focus", sync);
    window.addEventListener("online", sync);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", sync);
      window.removeEventListener("online", sync);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [enabled, token, userId, activeCallId, syncCurrentCall]);

  useEffect(() => onRealtime("chat.call.incoming", ({ callId } = {}) => {
    if (!callId || rejectIncomingWhileBusy(callId)) return;
    fetchCall(callId).then(presentIncomingCall).catch(() => syncCurrentCall().catch(() => {}));
  }), [onRealtime, fetchCall, presentIncomingCall, rejectIncomingWhileBusy, syncCurrentCall]);

  useEffect(() => onRealtime("chat.call.ended", ({ callId } = {}) => {
    finishLocalCall(callId);
  }), [onRealtime, finishLocalCall]);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return undefined;
    function handlePushMessage(event) {
      if (event?.data?.eventType === "chat.call.incoming") {
        syncCurrentCall().catch(() => {});
      }
    }
    navigator.serviceWorker.addEventListener("message", handlePushMessage);
    return () => navigator.serviceWorker.removeEventListener("message", handlePushMessage);
  }, [syncCurrentCall]);

  useEffect(() => {
    if (!enabled || !userId) return undefined;
    const client = getSupabaseClient();
    const channel = client
      .channel(`pg-call-participant-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "call_participant",
          filter: `user_id=eq.${userId}`,
        },
        async ({ new: next, old }) => {
          const callId = next?.call_id ?? old?.call_id;
          if (!callId) return;
          if (next?.status === "RINGING") {
            if (rejectIncomingWhileBusy(callId)) return;
            try {
              const call = await fetchCall(callId);
              if (call?.status !== "ENDED" && call?.initiatedByUserId !== userId) {
                presentIncomingCall(call);
              }
            } catch {}
            return;
          }
          if (next?.status === "JOINED") {
            if (!shouldResumeCallOnDevice(callId, next.status)) {
              dismissAnsweredOnOtherDevice(callId);
            }
            return;
          }
          if (["LEFT", "DECLINED", "MISSED"].includes(next?.status)) {
            finishLocalCall(callId);
          }
        },
      )
      .subscribe((status, error) => {
        if (["CHANNEL_ERROR", "TIMED_OUT"].includes(status)) {
          console.warn(`[atlas.calls] Canal de llamadas ${status}; se usara sincronizacion HTTP.`, error);
        }
      });
    return () => { client.removeChannel(channel); };
  }, [
    enabled,
    userId,
    fetchCall,
    presentIncomingCall,
    rejectIncomingWhileBusy,
    finishLocalCall,
    dismissAnsweredOnOtherDevice,
  ]);

  const watchedCallId = activeCallId ?? incomingCallId ?? null;
  useEffect(() => {
    if (!enabled || !watchedCallId) return undefined;
    const client = getSupabaseClient();
    const channel = client
      .channel(`pg-call-state-${watchedCallId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "call", filter: `id=eq.${watchedCallId}` },
        ({ new: next }) => {
          if (next?.status === "ENDED") finishLocalCall(watchedCallId);
        },
      )
      .subscribe();
    return () => { client.removeChannel(channel); };
  }, [enabled, watchedCallId, finishLocalCall]);

  // Realtime normally closes the remote UI immediately. This HTTP check covers
  // suspended tabs and transient reconnects.
  useEffect(() => {
    if (!enabled || !token || !activeCallId) return undefined;
    let running = false;
    async function syncActiveCall() {
      if (running) return;
      running = true;
      try {
        const call = await fetchCall(activeCallId);
        if (call?.status === "ENDED") finishLocalCall(activeCallId);
      } catch (error) {
        console.warn("[atlas.calls] No se pudo verificar la llamada activa:", error);
      } finally {
        running = false;
      }
    }
    const timer = window.setInterval(syncActiveCall, CURRENT_CALL_POLL_MS);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") syncActiveCall();
    };
    window.addEventListener("focus", syncActiveCall);
    window.addEventListener("online", syncActiveCall);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", syncActiveCall);
      window.removeEventListener("online", syncActiveCall);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [enabled, token, activeCallId, fetchCall, finishLocalCall]);

  useEffect(() => {
    if (!activeCallId || !token) return undefined;
    const leaveOnPageHide = () => leaveCallOnPageHide(activeCallId, token);
    window.addEventListener("pagehide", leaveOnPageHide);
    return () => window.removeEventListener("pagehide", leaveOnPageHide);
  }, [activeCallId, token]);
}
