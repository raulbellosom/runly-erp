import { useEffect } from "react";
import { toast } from "sonner";
import { useAuth } from "../auth/AuthProvider";
import {
  isWebPushSupported,
  getCurrentWebPushSubscription,
  subscribeCurrentDeviceToWebPush,
  syncCurrentDeviceWebPushSubscription,
} from "../lib/webPush";
import { runly } from "../lib/runly";
import {
  getSystemNotificationPermission,
  isTauriRuntime,
  requestSystemNotificationPermission,
} from "../lib/systemNotifications";
import { unlockCallSounds } from "../modules/runly.chat/calls/callSounds";
import { native } from '../native/index.js';
import { syncCurrentDeviceFcmToken } from '../lib/fcm.js';
import { createNotificationPreparation } from '../lib/notificationPreparation.js';
import { createNotificationPromptCooldown } from '../lib/notificationPromptCooldown.js';

const ENABLE_NOTIFICATIONS_TOAST_ID = "runly-enable-notifications";
const promptCooldown = createNotificationPromptCooldown();

function getPwaLabel() {
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches;
  if (isStandalone) {
    const title = document.title?.trim() || "Runly PWA";
    return title.length > 40 ? `${title.slice(0, 40)}...` : title;
  }
  const ua = navigator.userAgent ?? "";
  if (/iPhone|iPad/i.test(ua)) return "Safari iOS (web)";
  if (/Android/i.test(ua)) return "Android (web)";
  return "Navegador web";
}

function enableFromUserGesture(token) {
  const soundActivation = unlockCallSounds();

  const notificationActivation = isTauriRuntime()
    ? requestSystemNotificationPermission().then(async (permission) => {
        if (permission !== "granted") throw new Error("Permiso de notificaciones denegado.");
        await syncCurrentDeviceFcmToken({ authToken: token });
      })
    : subscribeCurrentDeviceToWebPush({ token, deviceLabel: getPwaLabel() });

  Promise.all([soundActivation, notificationActivation])
    .then(([soundUnlocked]) => {
      if (!soundUnlocked) throw new Error("El dispositivo no permitio activar el sonido.");
      toast.success(native.isMobile() ? "Notificaciones activadas." : "Notificaciones y sonidos activados.");
    })
    .catch((error) => {
      // The OS/browser permission state stays "default" after a decline (Tauri
      // can't tell "denied" from "never asked"), so without this the toast
      // would keep reappearing on every focus/online/periodic check.
      promptCooldown.markDismissed();
      toast.error(error?.message ?? "No se pudieron activar las notificaciones.");
    });
}

function declinePrompt() {
  promptCooldown.markDismissed();
}

function showEnablePrompt(token) {
  if (promptCooldown.isOnCooldown()) return;
  toast("Activa las notificaciones", {
    id: ENABLE_NOTIFICATIONS_TOAST_ID,
    description: native.isMobile()
      ? "Recibe avisos y llamadas incluso con Runly cerrado."
      : "Recibe avisos y escucha las llamadas aunque Runly no este visible.",
    duration: Infinity,
    action: {
      label: "Activar",
      onClick: () => enableFromUserGesture(token),
    },
    cancel: {
      label: "Ahora no",
      onClick: declinePrompt,
    },
    onDismiss: declinePrompt,
  });
}

async function prepareNotifications(token) {
  if (isTauriRuntime()) {
    const permission = await getSystemNotificationPermission().catch(() => "unsupported");
    if (permission === "default") { showEnablePrompt(token); return; }
    if (permission === "granted") {
      await syncCurrentDeviceFcmToken({ authToken: token }).catch(() => {});
    }
    return;
  }

  if (!isWebPushSupported()) return;
  if (typeof Notification !== "undefined" && Notification.permission === "denied") return;

  const keyResponse = await runly.notifications.getWebPushPublicKey(token).catch(() => null);
  if (!keyResponse?.data?.publicKey) return;

  const deviceLabel = getPwaLabel();
  const existing = await getCurrentWebPushSubscription().catch(() => null);
  if (existing) {
    await syncCurrentDeviceWebPushSubscription({ token, deviceLabel }).catch(() => {});
    return;
  }

  if (Notification.permission === "granted") {
    await subscribeCurrentDeviceToWebPush({ token, deviceLabel }).catch(() => {});
    return;
  }

  // Browsers require requestPermission() to run directly from a user gesture.
  // The toast action is that gesture; a delayed automatic prompt gets blocked.
  showEnablePrompt(token);
}

/**
 * Prepares notifications after login.
 * - If already subscribed, silently syncs the endpoint with the server.
 * - If permission is pending, offers an explicit activation action.
 * - In Tauri, enables native OS notifications instead of Web Push.
 * - Also checks again when a PWA shortcut is installed.
 */
export function usePushAutoSubscribe() {
  const { session, userProfile } = useAuth();
  const token = session?.access_token;
  useEffect(() => {
    if (!token || !userProfile?.id) return;
    const prepare = createNotificationPreparation(() => prepareNotifications(token));
    let installTimer = null;

    function refreshWhenVisible() {
      if (!document.hidden) prepare();
    }

    function handleAppInstalled() {
      if (installTimer !== null) window.clearTimeout(installTimer);
      installTimer = window.setTimeout(prepare, 3000);
    }

    window.addEventListener("appinstalled", handleAppInstalled);
    window.addEventListener('online', refreshWhenVisible);
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    const retryTimer = window.setInterval(refreshWhenVisible, 60_000);
    prepare();
    return () => {
      window.removeEventListener("appinstalled", handleAppInstalled);
      window.removeEventListener('online', refreshWhenVisible);
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      window.clearInterval(retryTimer);
      if (installTimer !== null) window.clearTimeout(installTimer);
    };
  }, [token, userProfile?.id]);
}
