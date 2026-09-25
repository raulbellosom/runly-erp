import { getApps, initializeApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";

// FCM error codes that mean the token itself is dead — never worth retrying.
// Anything else (network blip, internal-error, quota) is transient.
const PERMANENT_FCM_ERROR_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/invalid-argument",
  "messaging/invalid-recipient",
  "messaging/mismatched-credential",
  "messaging/sender-id-mismatch",
]);

function asErrorMessage(err) {
  if (err instanceof Error) return err.message;
  return String(err?.message ?? err);
}

export function isPermanentFcmError(err) {
  return PERMANENT_FCM_ERROR_CODES.has(err?.code ?? err?.errorInfo?.code);
}

// FCM data messages require every value to be a string — the Android
// receiver (RunlyMessagingService.kt) reads these same keys back out.
export function buildFcmData({ notification }) {
  const title = notification?.title ?? "Runly Notifications";
  const body = notification?.body ?? "";
  const link = notification?.link ?? "/app/m/runly.notifications";
  const eventType = notification?.eventType ?? "";
  const callId = eventType === "chat.call.incoming" ? String(notification?.sourceId ?? "") : "";
  const tag = eventType === "chat.call.incoming" && notification?.sourceId
    ? `call:${notification.sourceId}`
    : eventType === "chat.message.new" && notification?.sourceId
      ? `chat:${notification.sourceId}`
      : String(notification?.id ?? "");
  return { title, body, link, eventType, callId, tag };
}

let sharedApp = null;
function getFirebaseApp() {
  if (sharedApp) return sharedApp;
  // Zero-arg initializeApp() uses Application Default Credentials, i.e.
  // GOOGLE_APPLICATION_CREDENTIALS — see docs/mobile/FIREBASE_SETUP.md.
  sharedApp = getApps()[0] ?? initializeApp();
  return sharedApp;
}

export function createFcmService({ messaging = null } = {}) {
  function getClient() {
    if (messaging) return messaging;
    // Explicit kill switch, independent of whether a credential file is
    // mounted — same default-true pattern as CHAT_MIRAI_WEB in
    // mirai-service.js, so ops can disable FCM in prod without touching the
    // mounted secret.
    if (String(process.env.RUNLY_FCM_ENABLED ?? "true").toLowerCase() === "false") return null;
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) return null;
    return getMessaging(getFirebaseApp());
  }

  async function sendToToken({ token, payload }) {
    try {
      const client = getClient();
      if (!client) {
        return { ok: false, error: "FCM no configurado en el servidor." };
      }
      await client.send({ token, data: payload, android: { priority: "high" } });
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        permanentFailure: isPermanentFcmError(err),
        error: asErrorMessage(err),
      };
    }
  }

  return { sendToToken, buildFcmData };
}
