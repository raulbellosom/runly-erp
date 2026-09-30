package com.racoondevs.runlyerp

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

// Foreground service held for the whole duration of a WebView call so Android
// keeps the process, microphone, camera and network alive while the screen is
// locked or the app is in the background. The WebView owns all media; this
// service only raises the process priority and shows the ongoing-call notice.
class CallKeepAliveService : Service() {
  private var wakeLock: PowerManager.WakeLock? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val video = intent?.getBooleanExtra(EXTRA_VIDEO, false) ?: false
    try {
      ServiceCompat.startForeground(this, NOTIFICATION_ID, buildNotification(video), serviceTypes())
    } catch (error: Exception) {
      // Android 14+ rejects a type whose runtime permission isn't granted yet;
      // the web side calls start again once mic/camera are live.
      stopSelf()
      return START_NOT_STICKY
    }
    running = true
    if (wakeLock == null) {
      val power = getSystemService(Context.POWER_SERVICE) as PowerManager
      wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "runly:call").apply {
        setReferenceCounted(false)
        acquire(MAX_CALL_MS)
      }
    }
    MainActivity.keepWebViewAlive(true)
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    running = false
    wakeLock?.let { if (it.isHeld) it.release() }
    wakeLock = null
    MainActivity.keepWebViewAlive(false)
    super.onDestroy()
  }

  // A swipe-away from recents kills the WebView call; don't leave a stale notice.
  override fun onTaskRemoved(rootIntent: Intent?) {
    stopSelf()
    super.onTaskRemoved(rootIntent)
  }

  private fun granted(permission: String) =
    ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED

  private fun serviceTypes(): Int {
    if (Build.VERSION.SDK_INT < 29) return 0
    var types = ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
    if (Build.VERSION.SDK_INT >= 30) {
      if (granted(Manifest.permission.RECORD_AUDIO)) types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
      if (granted(Manifest.permission.CAMERA)) types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
    }
    return types
  }

  private fun buildNotification(video: Boolean): android.app.Notification {
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= 26) {
      manager.createNotificationChannel(
        NotificationChannel(CHANNEL_ID, "Llamada en curso", NotificationManager.IMPORTANCE_LOW),
      )
    }
    val open = PendingIntent.getActivity(
      this,
      0,
      Intent(this, MainActivity::class.java).apply {
        action = Intent.ACTION_MAIN
        flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
      },
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.mipmap.ic_launcher_monochrome)
      .setContentTitle(if (video) "Videollamada en curso" else "Llamada en curso")
      .setContentText("Toca para volver a la llamada.")
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setContentIntent(open)
      .setOngoing(true)
      .setSilent(true)
      .build()
  }

  companion object {
    private const val CHANNEL_ID = "runly-call-ongoing-v1"
    private const val NOTIFICATION_ID = 47002
    private const val EXTRA_VIDEO = "video"
    private const val MAX_CALL_MS = 6L * 60 * 60 * 1000

    @Volatile
    var running = false
      private set

    fun start(context: Context, video: Boolean) {
      val intent = Intent(context, CallKeepAliveService::class.java).putExtra(EXTRA_VIDEO, video)
      ContextCompat.startForegroundService(context, intent)
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, CallKeepAliveService::class.java))
    }
  }
}
