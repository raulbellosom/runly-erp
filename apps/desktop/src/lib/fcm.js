import { runly } from "./runly.js";
import { native } from "../native/index.js";

const STORAGE_KEY = "runly.notifications.fcm.token";

export function getStoredFcmToken() {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(STORAGE_KEY);
}

export function clearStoredFcmToken() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}

// Registers this device's current FCM token with the server if it hasn't
// been registered yet (or has rotated since the last sync). No-ops on
// anything that isn't the native Android app — FCM is Android-only for now.
export async function syncCurrentDeviceFcmToken({ authToken, deviceLabel = "Android" }) {
  if (!native.isMobile()) return { data: null };
  const fcmToken = await native.notifications.getPushToken().catch(() => null);
  if (!fcmToken) return { data: null };

  const response = await runly.notifications.subscribeFcm(authToken, { token: fcmToken, deviceLabel });
  window.localStorage.setItem(STORAGE_KEY, fcmToken);
  return response;
}
