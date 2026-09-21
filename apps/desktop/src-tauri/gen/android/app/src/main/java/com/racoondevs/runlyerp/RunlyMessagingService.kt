package com.racoondevs.runlyerp

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

// Receives FCM pushes when the app process is backgrounded or killed — the
// counterpart to HostNotifications.show(), which JS calls while the process
// is alive. Both converge on the same channel ids and deep-link scheme so
// Android can dedupe by notification id if both paths ever fire for the
// same event.
class RunlyMessagingService : FirebaseMessagingService() {
  override fun onNewToken(token: String) {
    prefs(this).edit().putString(KEY_TOKEN, token).apply()
  }

  override fun onMessageReceived(message: RemoteMessage) {
    val data = message.data
    val title = data["title"]?.take(300)?.ifBlank { null } ?: return
    val body = data["body"]?.take(2000) ?: ""
    val eventType = data["eventType"] ?: ""
    val callId = data["callId"] ?: ""
    val link = data["link"] ?: ""
    val tag = data["tag"]?.ifBlank { null } ?: "$title:$body"
    val channelId = if (eventType == "chat.call.incoming") "runly-calls-v1" else "runly-alerts-v1"
    val channelName = if (channelId == "runly-calls-v1") "Llamadas entrantes" else "Avisos de Runly"

    ensureChannel(channelId, channelName)

    val id = notificationId(tag)
    val intent = Intent(this, MainActivity::class.java).apply {
      action = Intent.ACTION_MAIN
      flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
    }
    if (Regex("^[a-zA-Z0-9-]{1,128}$").matches(callId)) {
      intent.action = Intent.ACTION_VIEW
      intent.setDataAndType(Uri.parse("runly://call/$callId"), "application/octet-stream")
    } else {
      val match = Regex("^/(?:app/)?m/runly\\.chat/chat/inbox/([a-zA-Z0-9-]{1,128})$").find(link)
      if (match != null) {
        intent.action = Intent.ACTION_VIEW
        intent.setDataAndType(Uri.parse("runly://chat/${match.groupValues[1]}"), "application/octet-stream")
      }
    }
    val contentIntent = PendingIntent.getActivity(
      this, id, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    val notification = NotificationCompat.Builder(this, channelId)
      .setSmallIcon(R.mipmap.ic_launcher_monochrome)
      .setContentTitle(title)
      .setContentText(body)
      .setContentIntent(contentIntent)
      .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
      .setAutoCancel(true)
      .setOnlyAlertOnce(true)
      .build()
    try {
      NotificationManagerCompat.from(this).notify(id, notification)
    } catch (_: SecurityException) {
      // Notification permission was revoked after the token was registered; drop silently.
    }
  }

  private fun ensureChannel(id: String, name: String) {
    if (Build.VERSION.SDK_INT < 26) return
    val manager = getSystemService(NotificationManager::class.java) ?: return
    val channel = NotificationChannel(id, name, NotificationManager.IMPORTANCE_HIGH).apply {
      lockscreenVisibility = NotificationCompat.VISIBILITY_PRIVATE
      enableVibration(true)
      enableLights(true)
    }
    manager.createNotificationChannel(channel)
  }

  companion object {
    private const val PREFS_NAME = "runly_fcm"
    private const val KEY_TOKEN = "token"

    fun prefs(context: Context): SharedPreferences =
      context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun currentToken(context: Context): String? = prefs(context).getString(KEY_TOKEN, null)

    // Ported 1:1 from apps/desktop/src/native/notification-policy.js#notificationId
    // (FNV-1a 32-bit) so a local (JS-triggered) and a remote (FCM-triggered)
    // notification for the same tag collapse to the same Android notification id.
    fun notificationId(tag: String): Int {
      var hash = 2166136261.toInt()
      for (ch in tag) hash = (hash xor ch.code) * 16777619
      val result = hash ushr 1
      return if (result == 0) 1 else result
    }
  }
}
